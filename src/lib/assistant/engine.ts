/**
 * The shopping assistant. It decides what a message is asking, then answers from real catalogue and price records.
 * Replies and figures are written by code. An LLM, when enabled, only extracts search details through a validated
 * schema. There is no path from here to saving, tracking, ordering or paying: those need the person's own click.
 */
import { z } from "zod";
import { KNOWN_BRANDS } from "@/lib/ai/fallback";
import { extractIntent } from "@/lib/ai/intent";
import { findAlternatives, searchCatalogue, type FallbackReason } from "@/lib/catalogue";
import type { ProductCard } from "@/lib/channel3/normalize";
import type { CategoryRow } from "@/lib/db/types";
import type { Deps } from "@/lib/deps";
import { lowestOffer } from "@/lib/discovery/filters";
import { hydrateCards, type ProductRef, type ShopCard } from "@/lib/discovery/service";
import { interpretQuestion, runQuery, type PriceQuery } from "@/lib/intelligence/query";
import type { IntelligenceRow } from "@/lib/intelligence/rows";
import { formatCents } from "@/lib/money";
import { compareSummary, dealVerdict } from "./deal";

export const slotsSchema = z.strictObject({
  product: z.string().max(160).optional(),
  brand: z.string().max(60).optional(),
  maxCents: z.number().int().positive().optional(),
  use: z.string().max(80).optional(),
  awaiting: z.enum(["product", "use"]).optional(),
});
export type Slots = z.infer<typeof slotsSchema>;

const refSchema = z.strictObject({ source: z.enum(["channel3", "seed"]), id: z.string().min(1).max(200) });

export const chatBody = z.strictObject({
  message: z.string().trim().min(1).max(500),
  slots: slotsSchema.default({}),
  productRef: refSchema.optional(),
  categorySlug: z.string().max(80).optional(),
  lastShown: z.array(refSchema).max(24).default([]),
});
export type ChatInput = z.infer<typeof chatBody>;

export type ChatKind = "question" | "results" | "compare" | "deal" | "alternatives" | "saved" | "help";
export type ChatReply = {
  kind: ChatKind;
  reply: string;
  points: string[];
  cards: ShopCard[];
  reasons: Record<string, string>;
  slots: Slots;
  compareHref: string | null;
  fallbackReason: FallbackReason | null;
  mode: "llm" | "basic";
  suggestions: string[];
};

export type SavedData = { rows: IntelligenceRow[]; savedOnly: ShopCard[] };

export type ChatEnv = {
  currency: string;
  categories: CategoryRow[];
  favouriteBrands: string[];
  /** Reads through the signed-in person's RLS client, never the service role. */
  loadSaved: () => Promise<SavedData>;
};

export type Intent = "saved" | "deal" | "alternatives" | "compare" | "find" | "greeting";

export function classify(message: string): Intent {
  const m = message.toLowerCase().trim();
  if (/\b(my saved|saved items?|my watch|i'?m watching|my items|my products|closest to my|my ideal|items? i saved|what i saved|dropped the most)\b/.test(m)) return "saved";
  if (/\b(good (deal|price|buy)|worth (it|buying|the price)|fair price|should i buy|buy (it|this) now)\b/.test(m)) return "deal";
  // "cheaper than $300" and "for less than $300" are budgets, not requests for alternatives.
  if (!/\b(cheaper|less) than\s*[$£€\d]/.test(m) && /\b(cheaper|alternatives?|for less|something similar|similar (to|products?|items?)|less expensive)\b/.test(m)) return "alternatives";
  if (/\b(compare|comparison|versus|vs\.?|which (one )?(is|should)|better value|the difference between)\b/.test(m)) return "compare";
  if (/^(hi|hello|hey|thanks|thank you|good (morning|afternoon|evening))\b[\s!.,]*$/.test(m)) return "greeting";
  return "find";
}

const USE_RE = /\b(school|university|college|uni|work|office|gaming|design|programming|coding|editing|travel|gym|running|kids?|students?)\b/i;
const NEEDS_USE = /\blaptops?\b|\bcomputers?\b/i;
const VAGUE_PRODUCT = /^(something|anything|stuff|a gift|gifts?|present|birthday gift|gift for .*|birthday gift for .*|a birthday gift for .*|a present for .*|present for .*|help)$/i;

const keyOf = (c: { source: string; id: string }) => `${c.source}:${c.id}`;
const compareHrefFor = (refs: ProductRef[]) => `/compare?items=${refs.slice(0, 4).map((r) => encodeURIComponent(keyOf(r))).join(",")}`;

/** Why a product is shown, from facts about it. At most two facts. */
export function reasonFor(card: ProductCard, slots: Slots, all: ProductCard[], favouriteBrands: string[]): string {
  const low = lowestOffer(card);
  const facts: string[] = [];
  if (low && slots.maxCents !== undefined && low.priceCents <= slots.maxCents) facts.push(`Within your ${formatCents(slots.maxCents, low.currency)} budget`);
  if (slots.brand && card.brand?.toLowerCase() === slots.brand.toLowerCase()) facts.push(`${card.brand}, the brand you asked for`);
  else if (card.brand && favouriteBrands.some((b) => b.toLowerCase() === card.brand!.toLowerCase())) facts.push(`${card.brand} is one of your favourites`);
  const prices = all.flatMap((c) => lowestOffer(c)?.priceCents ?? []);
  if (low && prices.length > 1 && low.priceCents === Math.min(...prices)) facts.push("Lowest price here");
  if (card.rating && card.rating.count > 0) facts.push(`Rated ${card.rating.value.toFixed(1)} by ${card.rating.count.toLocaleString("en-US")} shoppers`);
  if (card.offers.length > 1) facts.push(`${card.offers.length} retailers to compare`);
  return facts.slice(0, 2).join(". ");
}

const base = (over: Partial<ChatReply> & { reply: string; kind: ChatKind; slots: Slots }): ChatReply => ({
  points: [], cards: [], reasons: {}, compareHref: null, fallbackReason: null, mode: "basic", suggestions: [], ...over,
});

async function focusCard(deps: Deps, env: ChatEnv, input: ChatInput): Promise<ShopCard | null> {
  const ref = input.productRef ?? input.lastShown[0];
  if (!ref) return null;
  const [card] = await hydrateCards(deps, [ref], env.currency);
  return card ?? null;
}

async function answerDeal(deps: Deps, env: ChatEnv, input: ChatInput): Promise<ChatReply> {
  const card = await focusCard(deps, env, input);
  if (!card) {
    return base({ kind: "question", reply: "Which product do you mean? Open it and ask me there, or tell me what it is and I'll find it.", slots: input.slots, suggestions: ["Find me wireless headphones"] });
  }
  const { rows } = await env.loadSaved();
  const row = rows.find((r) => r.source === card.source && r.externalId === card.id) ?? null;
  const v = dealVerdict(card, row);
  return base({
    kind: "deal", reply: v.headline, points: v.points, cards: [card], slots: input.slots,
    suggestions: ["Find cheaper alternatives", "Compare with similar products"],
  });
}

async function answerAlternatives(deps: Deps, env: ChatEnv, input: ChatInput): Promise<ChatReply> {
  const card = await focusCard(deps, env, input);
  if (!card) {
    return base({ kind: "question", reply: "Happy to look. Which product do you want something similar to?", slots: input.slots });
  }
  const wantCheaper = /\b(cheaper|for less|less expensive|alternatives?)\b/i.test(input.message);
  const { cards, fallbackReason } = await findAlternatives(deps, card, env.currency);
  const low = lowestOffer(card);
  const matching = wantCheaper && low
    ? cards.filter((c) => { const l = lowestOffer(c); return l !== null && l.currency === low.currency && l.priceCents < low.priceCents; })
    : cards;
  if (matching.length === 0) {
    return base({
      kind: "alternatives", slots: input.slots, fallbackReason,
      reply: wantCheaper && low
        ? `I couldn't find anything similar for less than ${formatCents(low.priceCents, low.currency)} right now.`
        : "I couldn't find similar products right now.",
      suggestions: ["Is this a good deal?"],
    });
  }
  const fetchedAt = deps.now().toISOString();
  const shown = matching.slice(0, 8).map((c) => ({ ...c, fetchedAt }));
  const reasons: Record<string, string> = {};
  for (const c of shown) {
    const l = lowestOffer(c);
    if (l && low && l.currency === low.currency && l.priceCents < low.priceCents) reasons[keyOf(c)] = `${formatCents(low.priceCents - l.priceCents, l.currency)} less than ${card.title}`;
  }
  return base({
    kind: "alternatives", slots: input.slots, cards: shown, reasons, fallbackReason,
    reply: wantCheaper && low
      ? `Here's what I found for less than ${formatCents(low.priceCents, low.currency)}. Check they do what you need, since similar doesn't mean identical.`
      : "Here are some similar products. Tap Compare on any you'd like to weigh up.",
    compareHref: compareHrefFor([{ source: card.source, id: card.id }, ...shown.slice(0, 3).map((c) => ({ source: c.source, id: c.id }))]),
  });
}

/** What's left of a compare request once the comparing words are gone, such as "laptops under $500". */
function compareSubject(message: string): string {
  return message
    .replace(/\b(please|can you|could you|help me|compare|comparison|versus|vs\.?|which( one)?( is| should)?|better|value|i|buy|the difference between|two|three|some|these|those|them|both|this|they|are|is|a|an|the|with|and|or)\b/gi, " ")
    .replace(/[?!.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function answerCompare(deps: Deps, env: ChatEnv, input: ChatInput): Promise<ChatReply> {
  // "Compare laptops under $500" is a new search. "Compare these" is about what's on screen.
  const subject = compareSubject(input.message);
  const pointsAtShown = /\b(these|those|them|both|this|they)\b/i.test(input.message);
  if (subject && !pointsAtShown && !input.productRef) {
    const found = await answerFind(deps, env, { ...input, message: subject });
    return found.kind === "results" && found.cards.length >= 2
      ? { ...found, reply: `${found.reply} Pick a few with Compare, or open the side-by-side view below.` }
      : found;
  }
  const refs = [...(input.productRef ? [input.productRef] : []), ...input.lastShown.filter((r) => keyOf(r) !== (input.productRef ? keyOf(input.productRef) : ""))].slice(0, 4);
  if (refs.length < 2) {
    if (subject) return answerFind(deps, env, { ...input, message: subject });
    return base({ kind: "question", reply: "Tell me what you're choosing between, or find a couple of options first, then tap Compare on each one.", slots: input.slots, suggestions: ["Find me wireless headphones"] });
  }
  const cards = await hydrateCards(deps, refs, env.currency);
  return base({
    kind: "compare", reply: "Here's how they compare.", points: compareSummary(cards), cards, slots: input.slots,
    compareHref: compareHrefFor(refs),
  });
}

async function answerSaved(deps: Deps, env: ChatEnv, input: ChatInput): Promise<ChatReply> {
  const { query, mode } = await interpretQuestion(input.message, deps.callLlm);
  const { rows, savedOnly } = await env.loadSaved();
  if (rows.length === 0 && savedOnly.length === 0) {
    return base({ kind: "saved", reply: "You haven't saved anything yet. Tell me what you're after and tap the heart on anything you like.", slots: input.slots, mode, suggestions: ["Find me wireless headphones"] });
  }
  const rowCurrency = rows[0]?.currency ?? env.currency;
  const below = query.belowCents !== null && query.belowCurrency && query.belowCurrency !== rowCurrency ? null : query.belowCents;
  const matches = runQuery(rows, query, below);
  const cards = await hydrateCards(deps, matches.slice(0, 8).map((r) => ({ source: r.source, id: r.externalId })), env.currency);
  const reasons: Record<string, string> = {};
  for (const r of matches) {
    const k = `${r.source}:${r.externalId}`;
    if (r.reductionPercent !== null) reasons[k] = `${r.reductionPercent}% lower than the last price I recorded`;
    else if (r.toTargetCents !== null) reasons[k] = r.toTargetCents <= 0 ? "At or below your ideal price" : `${formatCents(r.toTargetCents, r.currency)} from your ideal price`;
  }
  const points: string[] = [];
  let shown = cards;
  // Hearted items have no ideal price, but they do have today's price, so "cheapest" can include them.
  if (query.sort === "lowest_price" && savedOnly.length > 0) {
    shown = [...cards, ...savedOnly.filter((c) => !cards.some((x) => keyOf(x) === keyOf(c)))]
      .sort((a, b) => (lowestOffer(a)?.priceCents ?? Number.MAX_SAFE_INTEGER) - (lowestOffer(b)?.priceCents ?? Number.MAX_SAFE_INTEGER))
      .slice(0, 8);
  } else if (savedOnly.length > 0) {
    points.push(`${savedOnly.length} of your saved ${savedOnly.length === 1 ? "item doesn't" : "items don't"} have an ideal price yet, so I'm not following ${savedOnly.length === 1 ? "its price" : "their prices"}.`);
  }
  const top = shown[0] ? lowestOffer(shown[0]) : null;
  const reply = query.sort === "lowest_price" && shown[0] && top
    ? `${shown[0].title} is your cheapest at ${formatCents(top.priceCents, top.currency)} today.`
    : savedAnswer(query, matches, rows.length);
  return base({ kind: "saved", reply, points, cards: shown, reasons, slots: input.slots, mode });
}

function savedAnswer(q: PriceQuery, matches: IntelligenceRow[], total: number): string {
  if (total === 0) return "None of your saved items have an ideal price yet, so I don't have prices to follow. Set one and I'll keep an eye on it.";
  const top = matches[0];
  const f = (c: number | null, cur: string) => (c === null ? "no price yet" : formatCents(c, cur));
  if (!top) {
    if (q.status === "target_reached") return "None of your items have reached your ideal price yet.";
    if (q.status === "price_dropped") return "I haven't recorded a price drop on any of your items.";
    if (q.staleOnly) return "Everything you're watching has been checked recently.";
    return "None of your saved items match that.";
  }
  if (q.sort === "biggest_drop" && top.reductionCents !== null) return `${top.title} has dropped the most: down ${top.reductionPercent}% from ${f(top.previousCents, top.currency)} to ${f(top.currentCents, top.currency)}.`;
  if (q.status === "target_reached") return `${matches.length === 1 ? "1 item is" : `${matches.length} items are`} at your ideal price. ${top.title} is ${f(top.currentCents, top.currency)}.`;
  if (q.sort === "closest_to_target" && top.toTargetCents !== null) {
    return top.toTargetCents <= 0
      ? `${top.title} is already at your ideal price, at ${f(top.currentCents, top.currency)}.`
      : `${top.title} is closest: ${f(top.toTargetCents, top.currency)} from your ideal price of ${f(top.targetCents, top.currency)}.`;
  }
  return `I found ${matches.length === 1 ? "1 item" : `${matches.length} items`}. ${top.title} is ${f(top.currentCents, top.currency)}.`;
}

/** Conversational words that aren't part of a product name. */
export function cleanProduct(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const cleaned = text
    .replace(/^(she|he|they|my \w+)\s+(loves?|likes?|enjoys?|is into|are into)\s+/i, "")
    .replace(/^(maybe|actually|ok|okay|yes|how about|what about|something like|something for)\s+/i, "")
    .replace(/\s+(instead|then|about|around|roughly|or so)\s*$/i, "")
    .replace(/^(instead|then|about|around|roughly)$/i, "")
    .trim();
  return cleaned || undefined;
}

/** Combine what was already known with what this message adds. */
export function mergeSlots(prev: Slots, parsed: { product?: string; brand?: string; maxCents?: number }, message: string): Slots {
  const useInMessage = USE_RE.exec(message)?.[0]?.toLowerCase();
  if (prev.awaiting === "use") {
    return { ...prev, awaiting: undefined, use: message.trim().toLowerCase().slice(0, 80), maxCents: parsed.maxCents ?? prev.maxCents };
  }
  if (prev.awaiting === "product") {
    return { product: parsed.product ?? message.trim().slice(0, 160), brand: parsed.brand ?? prev.brand, maxCents: parsed.maxCents ?? prev.maxCents, use: useInMessage ?? prev.use };
  }
  // A new product starts a new search. A bare budget or brand refines the current one.
  if (parsed.product) return { product: parsed.product, brand: parsed.brand, maxCents: parsed.maxCents, use: useInMessage };
  return { ...prev, brand: parsed.brand ?? prev.brand, maxCents: parsed.maxCents ?? prev.maxCents, use: useInMessage ?? prev.use };
}

async function answerFind(deps: Deps, env: ChatEnv, input: ChatInput): Promise<ChatReply> {
  const { intent, mode } = await extractIntent(input.message, env.currency, deps.callLlm);
  const named = intent.product === "unspecified" ? undefined : cleanProduct(intent.product);
  // A brand on its own ("Sony") narrows the current search rather than starting a new one.
  const brandOnly = named && input.slots.product && !input.slots.awaiting && KNOWN_BRANDS.some((b) => b.toLowerCase() === named.toLowerCase()) ? named : undefined;
  const slots = mergeSlots(
    input.slots,
    { product: brandOnly ? undefined : named, brand: brandOnly ?? intent.brand, maxCents: intent.currency === env.currency ? intent.maxPriceCents : undefined },
    input.message,
  );

  const category = input.categorySlug ? env.categories.find((c) => c.slug === input.categorySlug) : undefined;
  const vague = !slots.product || VAGUE_PRODUCT.test(slots.product.trim());
  // Inside a category, "something under $50" already says what kind of thing.
  const browseCategory = Boolean(category && vague);
  if (browseCategory) slots.product = category!.search_query;
  else if (!slots.product) return base({ kind: "question", mode, reply: "What are you looking for? A rough description is fine.", slots: { ...slots, awaiting: "product" } });
  else if (vague && input.slots.awaiting !== "product") {
    const gift = /gift|present/i.test(slots.product);
    return base({
      kind: "question", mode,
      reply: gift ? "Lovely idea. What are they into, and roughly how much do you want to spend?" : "Happy to help. What kind of thing are you after?",
      slots: { ...slots, product: undefined, awaiting: "product" },
    });
  }
  if (NEEDS_USE.test(slots.product!) && !slots.use && !USE_RE.test(slots.product!)) {
    return base({ kind: "question", mode, reply: "Are you mainly using it for everyday tasks, schoolwork, design, gaming or something else?", slots: { ...slots, awaiting: "use" }, suggestions: ["Everyday tasks", "Schoolwork", "Design", "Gaming"] });
  }

  const useSuffix = slots.use && !slots.product!.toLowerCase().includes(slots.use.toLowerCase()) ? ` for ${slots.use}` : "";
  const query = `${slots.product}${useSuffix}`;
  const result = await searchCatalogue(deps, query, {
    brand: slots.brand,
    maxCents: slots.maxCents,
    currency: env.currency,
    ...(category ? { categorySlugs: category.channel3_slugs, seedTerms: category.seed_terms, browseCategory } : {}),
  });
  const cards: ShopCard[] = result.products.filter((p) => p.offers.length > 0).slice(0, 12).map((c) => ({ ...c, fetchedAt: result.fetchedAt }));
  const where = category && !browseCategory ? ` in ${category.name}` : "";
  const label = browseCategory ? category!.name : query;

  if (cards.length === 0) {
    const limit = slots.maxCents !== undefined ? ` under ${formatCents(slots.maxCents, env.currency)}` : "";
    return base({
      kind: "results", mode, slots, fallbackReason: result.fallbackReason,
      reply: `I couldn't find ${slots.brand ? `${slots.brand} ` : ""}${label}${limit}${where}.`,
      suggestions: [...(limit ? ["Show me anything, whatever the price"] : []), ...(slots.brand ? ["Try any brand"] : [])],
    });
  }

  const reasons = Object.fromEntries(cards.map((c) => [keyOf(c), reasonFor(c, slots, cards, env.favouriteBrands)]));
  const budget = slots.maxCents !== undefined ? ` within ${formatCents(slots.maxCents, env.currency)}` : "";
  return base({
    kind: "results", mode, slots, cards, reasons, fallbackReason: result.fallbackReason,
    reply: `Got it. Here's what I found for ${slots.brand ? `${slots.brand} ` : ""}${label}${budget}${where}. Tap the heart to save one, or choose a few to compare.`,
    compareHref: cards.length >= 2 ? compareHrefFor(cards.slice(0, 3)) : null,
    suggestions: ["Compare these", "Is the first one a good deal?", "Find cheaper alternatives"],
  });
}

export async function chat(deps: Deps, env: ChatEnv, input: ChatInput): Promise<ChatReply> {
  // An answer to a question I asked is part of that search, whatever words it contains.
  if (input.slots.awaiting) return answerFind(deps, env, input);

  // Follow-ups like "show me anything" keep the current search but relax it.
  if (/whatever the price|any price|no budget/i.test(input.message) && input.slots.product) {
    return answerFind(deps, env, { ...input, message: input.slots.product, slots: { brand: input.slots.brand, use: input.slots.use } });
  }
  if (/\b(any|another) brand\b/i.test(input.message) && input.slots.product) {
    return answerFind(deps, env, { ...input, message: input.slots.product, slots: { maxCents: input.slots.maxCents, use: input.slots.use } });
  }

  switch (classify(input.message)) {
    case "saved": return answerSaved(deps, env, input);
    case "deal": return answerDeal(deps, env, input);
    case "alternatives": return answerAlternatives(deps, env, input);
    case "compare": return answerCompare(deps, env, input);
    case "greeting":
      return base({ kind: "help", reply: "Hi! Tell me what you're looking for and what you'd like to spend, and I'll help you find it.", slots: input.slots, suggestions: ["Find me a phone under $300", "I need a laptop for university", "Which of my saved items is cheapest?"] });
    default: return answerFind(deps, env, input);
  }
}
