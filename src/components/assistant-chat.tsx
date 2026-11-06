"use client";

import { Send, Sparkles } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { FallbackBanner, ProductGrid } from "@/components/product-grid";
import { buttonVariants } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/api/client";
import type { ChatReply, Slots } from "@/lib/assistant/engine";
import { currentCompare } from "@/lib/compare-store";

type Reply = ChatReply & { savedKeys: string[]; trackedByKey: Record<string, string> };
type Turn = { role: "user"; text: string } | { role: "assistant"; reply: Reply };
type Ref = { source: "channel3" | "seed"; id: string };

const STORE = "pricedrop:chat";
const STARTERS = [
  "Find me a good phone under $300",
  "I need a laptop for university",
  "Find affordable skincare for my routine",
  "Help me find a birthday gift for my sister",
  "Which of my saved items is cheapest?",
];

function parseRef(key: string | undefined): Ref | undefined {
  if (!key) return undefined;
  const i = key.indexOf(":");
  const source = key.slice(0, i);
  return source === "channel3" || source === "seed" ? { source, id: key.slice(i + 1) } : undefined;
}

export function AssistantChat({ initialPrompt, productKey, productTitle, categorySlug, categoryName, itemKeys, currency, savedKeys, trackedByKey }: {
  initialPrompt: string;
  productKey?: string;
  productTitle?: string;
  categorySlug?: string;
  categoryName?: string;
  itemKeys: string[];
  currency: string;
  savedKeys: string[];
  trackedByKey: Record<string, string>;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [slots, setSlots] = useState<Slots>({});
  const [shown, setShown] = useState<Ref[]>(() => itemKeys.flatMap((k) => parseRef(k) ?? []));
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);
  const latest = useRef<HTMLLIElement>(null);
  const hasContext = Boolean(productKey || categorySlug || itemKeys.length);
  const [picks, setPicks] = useState<{ savedKeys: string[]; trackedByKey: Record<string, string> }>({ savedKeys, trackedByKey });

  const send = useCallback(async (text: string, state: { slots: Slots; shown: Ref[] }) => {
    const clean = text.trim();
    if (!clean) return;
    setTurns((t) => [...t, { role: "user", text: clean }]);
    setValue("");
    setBusy(true);
    setError(null);
    try {
      // "Compare these" means the items ticked for comparing, when there are enough of them.
      const ticked = currentCompare().flatMap((k) => parseRef(k) ?? []);
      const refs = /compar|better|versus|\bvs\b/i.test(clean) && ticked.length >= 2 ? ticked : state.shown;
      const reply = await api<Reply>("/api/assistant/chat", {
        method: "POST",
        body: {
          message: clean,
          slots: state.slots,
          lastShown: refs.slice(0, 24),
          ...(parseRef(productKey) ? { productRef: parseRef(productKey) } : {}),
          ...(categorySlug ? { categorySlug } : {}),
        },
      });
      setTurns((t) => [...t, { role: "assistant", reply }]);
      setSlots(reply.slots);
      setPicks({ savedKeys: reply.savedKeys, trackedByKey: reply.trackedByKey });
      // A deal check is about one item on screen. It doesn't replace the list being discussed.
      if (reply.cards.length > 0 && reply.kind !== "deal") setShown(reply.cards.map((c) => ({ source: c.source, id: c.id })));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }, [productKey, categorySlug]);

  // A fresh question, or a chat carried over from earlier in this session.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const timer = setTimeout(() => {
      if (initialPrompt) {
        void send(initialPrompt, { slots: {}, shown: itemKeys.flatMap((k) => parseRef(k) ?? []) });
        // Reloading shouldn't ask the same question again.
        const url = new URL(window.location.href);
        url.searchParams.delete("q");
        window.history.replaceState(window.history.state, "", url);
        return;
      }
      if (hasContext) return;
      try {
        const saved = JSON.parse(sessionStorage.getItem(STORE) ?? "null") as { turns: Turn[]; slots: Slots; shown: Ref[] } | null;
        if (saved?.turns?.length) {
          setTurns(saved.turns);
          setSlots(saved.slots ?? {});
          setShown(saved.shown ?? []);
        }
      } catch {
        // Nothing to restore.
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [initialPrompt, send, itemKeys, hasContext]);

  useEffect(() => {
    if (turns.length === 0) return;
    try {
      sessionStorage.setItem(STORE, JSON.stringify({ turns: turns.slice(-20), slots, shown }));
    } catch {
      // Convenience only.
    }
    // Show the start of the newest message, so a long list of results doesn't push the reply out of view.
    latest.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [turns, slots, shown]);

  const submit = (text: string) => void send(text, { slots, shown });

  return (
    <div className="mx-auto grid min-h-[calc(100dvh-13rem)] w-full max-w-4xl grid-rows-[1fr_auto] gap-4 md:min-h-[calc(100dvh-9rem)]">
      <div className="grid min-w-0 content-start gap-4">
      {turns.length === 0 && !busy && (
        <div className="grid gap-3 py-4 text-center">
          <h1 className="text-3xl font-semibold sm:text-4xl">
            {productTitle ? "Ask me about this item" : categoryName ? `Let's find something in ${categoryName}` : "What are we shopping for today?"}
          </h1>
          <p className="break-words text-muted-foreground">
            {productTitle ?? "Tell me what you're looking for and I'll help you find it."}
          </p>
          <div className="mt-1 flex flex-wrap justify-center gap-2">
            {(productTitle ? ["Is this a good deal?", "Find cheaper alternatives", "Compare with similar products"] : STARTERS).map((s) => (
              <button key={s} type="button" onClick={() => submit(s)} className="min-h-9 rounded-full border bg-card px-3 py-1 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">{s}</button>
            ))}
          </div>
        </div>
      )}

      {(productTitle || categoryName) && turns.length > 0 && (
        <p className="text-center text-xs break-words text-muted-foreground">Talking about {productTitle ?? categoryName}</p>
      )}

      <ol aria-live="polite" className="grid gap-4">
        {turns.map((t, i) =>
          t.role === "user" ? (
            <li key={i} ref={i === turns.length - 1 ? latest : undefined} className="flex scroll-mt-20 justify-end">
              <p className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 break-words text-primary-foreground">{t.text}</p>
            </li>
          ) : (
            <li key={i} ref={i === turns.length - 1 ? latest : undefined} className="grid scroll-mt-20 gap-3">
              <div className="flex gap-2.5">
                <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent"><Sparkles className="size-4 text-primary" /></span>
                <div className="grid min-w-0 gap-1.5 rounded-2xl rounded-tl-md bg-card px-4 py-2.5 shadow-sm ring-1 ring-border">
                  <p className="break-words">{t.reply.reply}</p>
                  {t.reply.points.length > 0 && (
                    <ul className="grid gap-1 text-sm text-muted-foreground">
                      {t.reply.points.map((p) => <li key={p} className="break-words">{p}</li>)}
                    </ul>
                  )}
                  {t.reply.mode === "basic" && i === turns.length - 1 && t.reply.kind === "results" && (
                    <p className="text-xs text-muted-foreground">Basic mode: understood without AI.</p>
                  )}
                </div>
              </div>
              {/* Each demo card keeps its own label, so the longer explanation only needs saying once. */}
              {t.reply.fallbackReason && !turns.slice(0, i).some((x) => x.role === "assistant" && x.reply.fallbackReason) && <FallbackBanner reason={t.reply.fallbackReason} />}
              {t.reply.cards.length > 0 && (
                <ProductGrid cards={t.reply.cards} currency={currency} savedKeys={picks.savedKeys} trackedByKey={picks.trackedByKey} reasons={t.reply.reasons} suggestedTargetCents={t.reply.slots.maxCents} />
              )}
              {t.reply.compareHref && (
                <div><Link href={t.reply.compareHref} className={buttonVariants({ variant: "outline" })}>Compare your options</Link></div>
              )}
              {i === turns.length - 1 && t.reply.suggestions.length > 0 && !busy && (
                <div className="flex flex-wrap gap-2 sm:pl-10">
                  {t.reply.suggestions.map((s) => (
                    <button key={s} type="button" onClick={() => submit(s)} className="min-h-9 rounded-full border bg-card px-3 py-1 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">{s}</button>
                  ))}
                </div>
              )}
            </li>
          ),
        )}
        {busy && (
          <li className="flex items-center gap-2.5" role="status" aria-label="PriceDrop is looking">
            <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent"><Sparkles className="size-4 text-primary" /></span>
            <span className="flex gap-1 rounded-2xl bg-card px-4 py-3.5 ring-1 ring-border">
              {[0, 1, 2].map((d) => <span key={d} className="size-2 animate-bounce rounded-full bg-muted-foreground" style={{ animationDelay: `${d * 120}ms` }} />)}
            </span>
          </li>
        )}
      </ol>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </div>

      <form
        onSubmit={(e: FormEvent) => { e.preventDefault(); submit(value); }}
        className="sticky bottom-[4.5rem] z-20 md:bottom-4"
      >
        <label htmlFor="chat-input" className="sr-only">What are you looking for?</label>
        <div className="relative">
          <input
            id="chat-input"
            value={value}
            maxLength={500}
            onChange={(e) => setValue(e.target.value)}
            placeholder={slots.awaiting ? "Type your answer" : "What are you looking for?"}
            className="h-13 w-full rounded-full border border-input bg-card pr-14 pl-5 text-base shadow-md outline-none focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-ring/30"
          />
          <button type="submit" disabled={busy} aria-label="Send" className="absolute top-1/2 right-1.5 flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
            <Send aria-hidden className="size-4" />
          </button>
        </div>
      </form>
    </div>
  );
}
