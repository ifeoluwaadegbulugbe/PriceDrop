import Link from "next/link";
import { CircleCheck, CircleHelp } from "lucide-react";
import { Logo } from "@/components/logo";
import { buttonVariants } from "@/components/ui/button";

const STEPS = [
  { title: "Say what you want", body: "\"Sony headphones, no more than $90.\" Plain language. You check what we understood before anything happens." },
  { title: "We watch the prices", body: "Pick a product and set your rules. We check about every 30 minutes, record each price, and show you when we last looked." },
  { title: "You decide when to buy", body: "When an offer meets your rules, we show you why, rule by rule. Nothing is paid until you approve it at PayPal." },
];

export default function Landing() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4">
        <Logo />
        <nav className="flex items-center gap-1">
          <Link href="/login" className={buttonVariants({ variant: "ghost" })}>Log in</Link>
          <Link href="/signup" className={buttonVariants({})}>Sign up</Link>
        </nav>
      </header>

      <main className="flex-1">
        <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 pt-10 pb-16 lg:grid-cols-[1.15fr_1fr] lg:pt-20">
          <div>
            <h1 className="text-5xl leading-[1.02] font-semibold sm:text-6xl lg:text-7xl">The shopping agent that knows when to buy.</h1>
            <p className="mt-6 max-w-xl text-lg text-muted-foreground">
              Tell PriceDrop what you want and what you&apos;re willing to pay. We&apos;ll watch the prices and help you act when the right deal appears.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/signup" className={buttonVariants({ size: "lg", className: "h-12 px-6 text-base" })}>Start watching a price</Link>
            </div>
          </div>

          <figure aria-label="Example of a deal evaluation" className="m-0 rounded-2xl border bg-card p-5 shadow-sm">
            <figcaption className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Example</figcaption>
            <p className="mt-2 font-display text-xl font-semibold">Wireless headphones</p>
            <p className="tnum mt-3 font-display text-4xl font-semibold">$79.99</p>
            <p className="tnum mt-1 inline-flex rounded-full bg-deal-soft px-2 py-0.5 text-xs font-medium text-deal">$10.01 below your $90.00 target</p>
            <ul className="mt-4 grid gap-2 text-sm">
              <li className="flex gap-2"><CircleCheck aria-hidden className="size-4 shrink-0 text-deal" />At or below your target</li>
              <li className="flex gap-2"><CircleCheck aria-hidden className="size-4 shrink-0 text-deal" />Retailer is allowed</li>
              <li className="flex gap-2"><CircleCheck aria-hidden className="size-4 shrink-0 text-deal" />In stock</li>
              <li className="flex gap-2"><CircleHelp aria-hidden className="size-4 shrink-0 text-caution" />Shipping isn&apos;t stated, so the total could be higher</li>
            </ul>
          </figure>
        </section>

        <section aria-label="How it works" className="border-y bg-card">
          <ol className="mx-auto grid max-w-6xl gap-8 px-4 py-12 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s.title}>
                <p className="tnum font-display text-sm font-semibold text-primary">{i + 1}</p>
                <h2 className="mt-1 text-xl font-semibold">{s.title}</h2>
                <p className="mt-2 text-sm text-muted-foreground">{s.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section aria-label="What to know" className="mx-auto max-w-6xl px-4 py-10">
          <div className="rounded-2xl bg-caution-soft p-5 text-sm text-caution">
            <p className="font-semibold">This is a prototype running in PayPal&apos;s sandbox.</p>
            <p className="mt-1">No real money moves and no retailer ships an item. Payments are never taken without your approval at PayPal, and automatic checks are best effort, not continuous.</p>
          </div>
        </section>
      </main>

      <footer className="border-t">
        <p className="mx-auto max-w-6xl px-4 py-6 text-xs text-muted-foreground">PriceDrop prototype. Open source under the MIT License.</p>
      </footer>
    </div>
  );
}
