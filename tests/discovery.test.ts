/** Discovery, personalisation, trending and Buy now against the emulator: real Postgres, real SQL, fake PayPal. */
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/errors";
import { buyNow, captureCheckout, cancelCheckout } from "@/lib/checkout/service";
import type { ProductCard } from "@/lib/channel3/normalize";
import type { CategoryRow, OrderRow } from "@/lib/db/types";
import type { Deps } from "@/lib/deps";
import {
  categoryProducts, childrenOf, hydrateCards, loadCategories, pickedForYou, popularProducts, recordView, saveProduct, topLevel,
  trendingDrops, unsaveProduct, warmOneCategory, LIST_TTL_MS, SNAPSHOT_TTL_MS,
} from "@/lib/discovery/service";
import { createPaypalClient, PaypalError } from "@/lib/paypal/client";
import { paypalFailure } from "@/lib/checkout/service";
import { createTracking } from "@/lib/tracking/service";
import { SERVICE_KEY, startStack, type Stack } from "../scripts/local/stack";

let stack: Stack;
let db: SupabaseClient;
let deps: Deps;
let clock = new Date();
const advance = (ms: number) => { clock = new Date(clock.getTime() + ms); };

const liveCard = (id: string, brand = "Sony", cents = 5000): ProductCard => ({
  id, source: "channel3", title: `Live ${id}`, brand, imageUrl: `https://img.example/${id}.png`,
  offers: [{ domain: "shop.example", priceCents: cents, shippingCents: null, currency: "USD", inStock: true, url: "https://buy.example/x", variantLabel: null }],
});

function gateway(cards: ProductCard[]) {
  const calls = { search: 0, retrieve: 0 };
  return {
    calls,
    search: async () => { calls.search++; return cards; },
    retrieve: async (id: string) => {
      calls.retrieve++;
      const c = cards.find((x) => x.id === id);
      if (!c) throw new Error("gone");
      return c;
    },
    similar: async () => cards,
  };
}

async function newUser(): Promise<string> {
  const { data, error } = await db.auth.admin.createUser({ email: `d-${randomUUID()}@example.com`, password: "pw-123456", email_confirm: true });
  if (error) throw error;
  return data.user.id;
}
const code = async (p: Promise<unknown>) => p.then(() => "ok", (e) => (e instanceof ApiError ? e.code : `other:${e}`));
let categories: CategoryRow[];
const cat = (slug: string) => categories.find((c) => c.slug === slug)!;

beforeAll(async () => {
  stack = await startStack();
  db = createClient(stack.url, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
});
afterAll(async () => stack.close());
beforeEach(async () => {
  deps = {
    db, channel3: null,
    paypal: createPaypalClient({ clientId: "x", clientSecret: "y", baseUrl: `${stack.url}/paypal-sandbox` }),
    callLlm: async () => null, channel3Budget: 500, demoMode: false, appUrl: "http://localhost:3000", now: () => clock,
  };
  categories = await loadCategories(deps);
  await db.from("discovery_cache").delete().neq("key", "");
});

describe("categories", () => {
  it("has the 12 requested top-level categories, in order, each with subcategories", () => {
    const tops = topLevel(categories);
    expect(tops.map((c) => c.name)).toEqual([
      "Electronics", "Fashion", "Beauty", "Home & Living", "Computers & Accessories", "Home Appliances",
      "Sports & Fitness", "Gaming", "Baby & Kids", "Books & Stationery", "Automotive", "Accessories",
    ]);
    for (const c of tops) expect(childrenOf(categories, c).length).toBeGreaterThan(0);
    expect(childrenOf(categories, cat("electronics")).map((c) => c.name)).toEqual(["Smartphones", "Tablets", "Televisions", "Audio", "Cameras", "Wearables"]);
  });

  it("an inactive category disappears without code changes", async () => {
    await db.from("categories").update({ active: false }).eq("slug", "automotive");
    expect((await loadCategories(deps)).some((c) => c.slug === "automotive")).toBe(false);
    await db.from("categories").update({ active: true }).eq("slug", "automotive");
  });
});

describe("category products", () => {
  it("with no key, shows labelled demo items, or nothing at all, never filler", async () => {
    const audio = await categoryProducts(deps, cat("audio"), "USD", { allowRefresh: true });
    expect(audio.source).toBe("seed");
    expect(audio.fallbackReason).toBe("no_api_key");
    expect(audio.cards.every((c) => c.source === "seed" && /headphones|airpods/i.test(c.title))).toBe(true);

    const beauty = await categoryProducts(deps, cat("beauty"), "USD", { allowRefresh: true });
    expect(beauty.cards).toEqual([]);
    expect(beauty.source).toBe("none");
  });

  it("caches the list: one paid search, then free for 48 hours", async () => {
    const g = gateway([liveCard("a"), liveCard("b")]);
    const d = { ...deps, channel3: g };
    await categoryProducts(d, cat("gaming"), "USD", { allowRefresh: true });
    await categoryProducts(d, cat("gaming"), "USD", { allowRefresh: true });
    expect(g.calls.search).toBe(1);
    advance(LIST_TTL_MS + 1000);
    await categoryProducts(d, cat("gaming"), "USD", { allowRefresh: true });
    expect(g.calls.search).toBe(2);
  });

  it("reuses a snapshot for 30 minutes, then refreshes through the free call with a new time", async () => {
    const g = gateway([liveCard("s1")]);
    const d = { ...deps, channel3: g };
    await categoryProducts(d, cat("gaming"), "USD", { allowRefresh: true });
    const first = await hydrateCards(d, [{ source: "channel3", id: "s1" }], "USD");
    expect(g.calls.retrieve).toBe(0);
    advance(SNAPSHOT_TTL_MS + 1000);
    const second = await hydrateCards(d, [{ source: "channel3", id: "s1" }], "USD");
    expect(g.calls.retrieve).toBe(1);
    expect(second[0]!.fetchedAt > first[0]!.fetchedAt).toBe(true);
  });

  it("if a refresh fails, an older price keeps its true time", async () => {
    const g = gateway([liveCard("old")]);
    await categoryProducts({ ...deps, channel3: g }, cat("gaming"), "USD", { allowRefresh: true });
    const then = clock.getTime();
    advance(SNAPSHOT_TTL_MS + 1000);
    const down = { ...g, retrieve: async () => { throw new Error("down"); } };
    const [card] = await hydrateCards({ ...deps, channel3: down }, [{ source: "channel3", id: "old" }], "USD");
    expect(new Date(card!.fetchedAt).getTime()).toBe(then);
  });

  it("drops a product it can't verify rather than inventing one", async () => {
    expect(await hydrateCards({ ...deps, channel3: gateway([]) }, [{ source: "channel3", id: "never" }], "USD")).toEqual([]);
  });

  it("never stores offer links", async () => {
    const g = gateway([liveCard("nolink")]);
    await categoryProducts({ ...deps, channel3: g }, cat("gaming"), "USD", { allowRefresh: true });
    const { data } = await db.from("discovery_cache").select("value").eq("key", "product:USD:nolink").single();
    expect(JSON.stringify(data)).not.toContain("buy.example");
  });

  it("over budget: uses a stale list, and falls back only when there's nothing else", async () => {
    const g = gateway([liveCard("kept")]);
    const when = new Date("2033-03-10T00:00:00Z");
    const d: Deps = { ...deps, channel3: g, now: () => when, channel3Budget: 0 };
    const none = await categoryProducts(d, cat("audio"), "USD", { allowRefresh: true });
    expect(none).toMatchObject({ source: "seed", fallbackReason: "budget_exhausted" });
    expect(g.calls.search).toBe(0);
  });

  it("a cold page view can skip spending", async () => {
    const g = gateway([liveCard("x")]);
    expect(await categoryProducts({ ...deps, channel3: g }, cat("gaming"), "USD", { allowRefresh: false })).toMatchObject({ cards: [], source: "none" });
    expect(g.calls.search).toBe(0);
  });

  it("the monitor warms at most one category, and stops at 60% of budget", async () => {
    const g = gateway([liveCard("w")]);
    const when = new Date("2034-01-10T00:00:00Z");
    const d: Deps = { ...deps, channel3: g, channel3Budget: 10, now: () => when };
    expect(await warmOneCategory(d)).not.toBeNull();
    expect(g.calls.search).toBe(1);
    await db.from("usage_counters").upsert({ key: "budget:channel3:2034-01", count: 6 }, { onConflict: "key" });
    expect(await warmOneCategory(d)).toBeNull();
    expect(g.calls.search).toBe(1);
  });
});

describe("personalisation", () => {
  it("is empty without interests, and doesn't pretend", async () => {
    expect(await pickedForYou(deps, { interests: [], favourite_brands: [], currency: "USD" }, categories)).toEqual({ cards: [], basedOn: [], source: "none" });
  });
  it("uses saved interests and says which", async () => {
    const r = await pickedForYou(deps, { interests: ["computers-accessories"], favourite_brands: [], currency: "USD" }, categories);
    expect(r.basedOn).toEqual(["Computers & Accessories"]);
    expect(r.cards.length).toBeGreaterThan(0);
    expect(r.cards.every((c) => /laptop|macbook/i.test(c.title))).toBe(true);
  });
  it("different interests give different products", async () => {
    const a = await pickedForYou(deps, { interests: ["computers-accessories"], favourite_brands: [], currency: "USD" }, categories);
    const b = await pickedForYou(deps, { interests: ["electronics"], favourite_brands: [], currency: "USD" }, categories);
    expect(a.cards[0]!.id).not.toBe(b.cards[0]!.id);
  });
  it("puts favourite brands first and honours preferences", async () => {
    const base = { interests: ["computers-accessories"], currency: "USD" };
    expect((await pickedForYou(deps, { ...base, favourite_brands: ["Dell"] }, categories)).cards[0]!.brand).toBe("Dell");
    const cheap = await pickedForYou(deps, { ...base, favourite_brands: [], shopping_preferences: ["lowest_price"] }, categories);
    const prices = cheap.cards.map((c) => Math.min(...c.offers.map((o) => o.priceCents)));
    expect(prices).toEqual([...prices].sort((x, y) => x - y));
  });
  it("names only categories that actually contributed products", async () => {
    const r = await pickedForYou(deps, { interests: ["computers-accessories", "beauty"], favourite_brands: [], currency: "USD" }, categories);
    expect(r.basedOn).toEqual(["Computers & Accessories"]);
  });
  it("interests are saved per profile and persist", async () => {
    const u = await newUser();
    await db.from("profiles").update({ interests: ["beauty", "gaming"] }).eq("id", u);
    expect((await db.from("profiles").select("interests").eq("id", u).single()).data).toEqual({ interests: ["beauty", "gaming"] });
  });
});

describe("verified price drops", () => {
  async function trackedWith(prices: { cents: number; source: string; hoursAgo: number; in_stock?: boolean }[]) {
    const u = await newUser();
    const { data: p } = await db.from("products").insert({ source: "channel3", external_id: `t-${randomUUID()}`, title: `Drop ${randomUUID().slice(0, 4)}` }).select().single();
    const { data: t } = await db.from("tracked_products").insert({ user_id: u, product_id: p!.id, target_price_cents: 1, max_total_cents: 1 }).select().single();
    for (const o of prices) {
      await db.from("price_observations").insert({
        tracked_product_id: t!.id, domain: "shop.example", price_cents: o.cents, currency: "USD", source: o.source, in_stock: o.in_stock ?? true,
        observed_at: new Date(clock.getTime() - o.hoursAgo * 3600 * 1000).toISOString(),
      });
    }
    return p!.title as string;
  }
  const titles = async (d = deps) => (await trendingDrops(d, 200)).map((x) => x.title);

  it("shows a real recorded fall with the true percentage", async () => {
    const title = await trackedWith([{ cents: 10000, source: "channel3_live", hoursAgo: 48 }, { cents: 8500, source: "channel3_live", hoursAgo: 1 }]);
    const drop = (await trendingDrops(deps, 200)).find((x) => x.title === title)!;
    expect(drop).toMatchObject({ priceCents: 8500, previousCents: 10000, percent: 15, simulated: false });
  });
  it("doesn't show a rise, a flat price, or a tiny wobble", async () => {
    const rise = await trackedWith([{ cents: 8000, source: "channel3_live", hoursAgo: 48 }, { cents: 9000, source: "channel3_live", hoursAgo: 1 }]);
    const flat = await trackedWith([{ cents: 8000, source: "channel3_live", hoursAgo: 48 }, { cents: 8000, source: "channel3_live", hoursAgo: 1 }]);
    const wobble = await trackedWith([{ cents: 10000, source: "channel3_live", hoursAgo: 48 }, { cents: 9950, source: "channel3_live", hoursAgo: 1 }]);
    const t = await titles();
    for (const x of [rise, flat, wobble]) expect(t).not.toContain(x);
  });
  it("doesn't show a single price, however low", async () => {
    const x = await trackedWith([{ cents: 100, source: "channel3_live", hoursAgo: 1 }]);
    expect(await titles()).not.toContain(x);
  });
  it("doesn't show old drops, out of stock items, or demo catalogue data", async () => {
    const old = await trackedWith([{ cents: 10000, source: "channel3_live", hoursAgo: 400 }, { cents: 5000, source: "channel3_live", hoursAgo: 300 }]);
    const oos = await trackedWith([{ cents: 10000, source: "channel3_live", hoursAgo: 48 }, { cents: 5000, source: "channel3_live", hoursAgo: 1, in_stock: false }]);
    const seed = await trackedWith([{ cents: 10000, source: "seed", hoursAgo: 48 }, { cents: 5000, source: "seed", hoursAgo: 1 }]);
    const t = await titles();
    for (const x of [old, oos, seed]) expect(t).not.toContain(x);
  });
  it("a simulated price is excluded, and in demo mode it is labelled", async () => {
    const sim = await trackedWith([{ cents: 10000, source: "channel3_live", hoursAgo: 48 }, { cents: 5000, source: "demo_simulation", hoursAgo: 1 }]);
    expect(await titles()).not.toContain(sim);
    const demo = (await trendingDrops({ ...deps, demoMode: true }, 200)).find((x) => x.title === sim)!;
    expect(demo.simulated).toBe(true);
  });
  it("a return from a simulation to the real price isn't a drop", async () => {
    const x = await trackedWith([{ cents: 20000, source: "demo_simulation", hoursAgo: 48 }, { cents: 8000, source: "channel3_live", hoursAgo: 1 }]);
    expect(await titles()).not.toContain(x);
  });
});

describe("popular products", () => {
  it("needs at least two people", async () => {
    const g = gateway([liveCard("pop")]);
    const d = { ...deps, channel3: g };
    const a = await newUser();
    await saveProduct(d, a, { source: "channel3", id: "pop" }, "USD");
    expect((await popularProducts(d, "USD", 200)).some((c) => c.id === "pop")).toBe(false);
    const b = await newUser();
    await saveProduct(d, b, { source: "channel3", id: "pop" }, "USD");
    expect((await popularProducts(d, "USD", 200)).some((c) => c.id === "pop")).toBe(true);
  });
});

describe("watchlist and recently viewed", () => {
  it("saves once, unsaves, and is per user", async () => {
    const a = await newUser();
    const b = await newUser();
    const ref = { source: "seed" as const, id: "seed-hp-pavilion-14" };
    await saveProduct(deps, a, ref, "USD");
    await saveProduct(deps, a, ref, "USD");
    const count = async (u: string) => (await db.from("saved_products").select("product_id").eq("user_id", u)).data!.length;
    expect(await count(a)).toBe(1);
    expect(await count(b)).toBe(0);
    await unsaveProduct(deps, b, ref);
    expect(await count(a)).toBe(1);
    await unsaveProduct(deps, a, ref);
    expect(await count(a)).toBe(0);
  });
  it("rejects a product that doesn't exist", async () => {
    expect(await code(saveProduct(deps, await newUser(), { source: "seed", id: "made-up" }, "USD"))).toBe("not_found");
  });
  it("a repeat view moves it to the front, without duplicates", async () => {
    const u = await newUser();
    await recordView(deps, u, liveCard("v1"));
    advance(1000);
    await recordView(deps, u, liveCard("v2"));
    advance(1000);
    await recordView(deps, u, liveCard("v1"));
    const { data } = await db.from("recently_viewed").select("product_id,viewed_at").eq("user_id", u).order("viewed_at", { ascending: false });
    expect(data!.length).toBe(2);
    const { data: first } = await db.from("products").select("external_id").eq("id", data![0]!.product_id).single();
    expect(first!.external_id).toBe("v1");
  });
});

describe("buy now, with no deal needed", () => {
  const ref = { source: "seed" as const, id: "seed-dell-xps-13", domain: "cobalt-computers.example" };

  it("buys at the current price, end to end, after approval only", async () => {
    const u = await newUser();
    const { order } = await buyNow(deps, u, ref, "USD");
    expect(order).toMatchObject({ status: "payer_action_required", amount_cents: 119900, deal_alert_id: null, retailer_domain: ref.domain });
    expect((await captureCheckout(deps, u, order.id)).outcome).toBe("awaiting_approval");
    expect((await db.from("purchases").select("id").eq("paypal_order_row", order.id)).data).toEqual([]);

    stack.paypal.approve(order.paypal_order_id!);
    const r = await captureCheckout(deps, u, order.id);
    expect(r.outcome).toBe("captured");
    expect(r.purchase).toMatchObject({ amount_cents: 119900, retailer_domain: ref.domain, is_sandbox: true });
    expect((await captureCheckout(deps, u, order.id)).outcome).toBe("already_captured");
    expect((await db.from("purchases").select("id").eq("paypal_order_row", order.id)).data!.length).toBe(1);
  });

  it("buying above your target is allowed, and ends tracking of that product", async () => {
    const u = await newUser();
    const { tracked } = await createTracking(deps, u, { source: "seed", externalId: ref.id, targetPriceCents: 100, maxTotalCents: 100, allowedDomains: [], allowedVariants: null, requireInStock: true });
    const { order } = await buyNow(deps, u, ref, "USD");
    stack.paypal.approve(order.paypal_order_id!);
    expect((await captureCheckout(deps, u, order.id)).outcome).toBe("captured");
    expect((await db.from("tracked_products").select("status").eq("id", tracked.id).single()).data!.status).toBe("purchased");
  });

  it("includes known shipping in the amount", async () => {
    const { order } = await buyNow(deps, await newUser(), { source: "seed", id: "seed-acer-aspire-5", domain: "harbor-electronics.example" }, "USD");
    expect(order.amount_cents).toBe(44999 + 1499);
  });

  it("double-click makes one order", async () => {
    const u = await newUser();
    const before = stack.paypal.createCalls;
    const results = await Promise.all([1, 2, 3].map(() => buyNow(deps, u, ref, "USD")));
    expect(new Set(results.map((r) => r.order.id)).size).toBe(1);
    expect(stack.paypal.createCalls - before).toBe(1);
  });

  it("if the price changed, the old order isn't reused", async () => {
    const u = await newUser();
    const d1: Deps = { ...deps, channel3: gateway([liveCard("mv", "Sony", 5000)]) };
    const first = await buyNow(d1, u, { source: "channel3", id: "mv", domain: "shop.example" }, "USD");
    const d2: Deps = { ...deps, channel3: gateway([liveCard("mv", "Sony", 6000)]) };
    const second = await buyNow(d2, u, { source: "channel3", id: "mv", domain: "shop.example" }, "USD");
    expect(second.order.id).not.toBe(first.order.id);
    expect(second.order.amount_cents).toBe(6000);
    expect((await db.from("paypal_orders").select("status").eq("id", first.order.id).single()).data!.status).toBe("cancelled");
  });

  it("refuses out of stock, unknown retailers and made-up products", async () => {
    const u = await newUser();
    expect(await code(buyNow(deps, u, { source: "seed", id: "seed-asus-zenbook-14", domain: "cobalt-computers.example" }, "USD"))).toBe("out_of_stock");
    expect(await code(buyNow(deps, u, { ...ref, domain: "evil.example" }, "USD"))).toBe("offer_gone");
    expect(await code(buyNow(deps, u, { source: "seed", id: "nope", domain: "x.example" }, "USD"))).toBe("not_found");
  });

  it("another person can't capture or cancel it", async () => {
    const a = await newUser();
    const b = await newUser();
    const { order } = await buyNow(deps, a, ref, "USD");
    stack.paypal.approve(order.paypal_order_id!);
    expect(await code(captureCheckout(deps, b, order.id))).toBe("not_found");
    expect(await code(cancelCheckout(deps, b, order.id))).toBe("not_found");
    expect((await cancelCheckout(deps, a, order.id)).status).toBe("cancelled");
  });

  it("a PayPal refusal records the real reason and charges nothing", async () => {
    const u = await newUser();
    const failing: Deps = {
      ...deps,
      paypal: { ...deps.paypal!, createOrder: async () => { throw new PaypalError(401, "AUTHENTICATION_FAILURE", null, "dbg1"); } },
    };
    const err = await buyNow(failing, u, ref, "USD").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.publicMessage).toMatch(/rejected this site's sandbox credentials/);
    const { data } = await db.from("paypal_orders").select("*").eq("user_id", u);
    expect((data as OrderRow[])[0]).toMatchObject({ status: "failed", failure_reason: "AUTHENTICATION_FAILURE" });
    expect((await db.from("purchases").select("id").eq("user_id", u)).data).toEqual([]);
  });

  it("failure messages say what PayPal said, and never credentials", () => {
    const e = paypalFailure(new PaypalError(422, "UNPROCESSABLE_ENTITY", "CURRENCY_NOT_SUPPORTED", "dbg2"));
    expect(e.publicMessage).toContain("CURRENCY_NOT_SUPPORTED");
    expect(e.publicMessage).toContain("dbg2");
    expect(paypalFailure(new Error("secret-token")).publicMessage).not.toContain("secret-token");
  });
});
