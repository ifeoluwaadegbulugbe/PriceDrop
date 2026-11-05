/**
 * One real Channel3 search (costs 1 credit) and one retrieve (free), through the app's own gateway.
 * Prints raw prices next to normalized ones so the unit assumption can be checked. Never prints the key.
 *   npm run channel3:smoke -- "sony headphones"
 * With --raw=<path>, also saves the raw product JSON there for inspection.
 */
import { writeFileSync } from "node:fs";
import { Channel3 } from "@channel3/sdk";
import { config } from "dotenv";
import { normalizeProduct, type RawProduct } from "../src/lib/channel3/normalize";

config({ path: ".env.local" });

async function main() {
  const apiKey = process.env.CHANNEL3_API_KEY;
  if (!apiKey) {
    console.log("CHANNEL3_API_KEY isn't set in .env.local. Nothing was run.");
    process.exitCode = 1;
    return;
  }
  const query = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "sony headphones";
  const rawPath = process.argv.find((a) => a.startsWith("--raw="))?.slice(6);
  const client = new Channel3({ apiKey });

  const page = await client.products.search({ query, limit: 3 }, { timeoutInSeconds: 20, maxRetries: 1 });
  console.log(`Search "${query}": ${page.data.length} products`);
  for (const p of page.data) {
    const card = normalizeProduct(p as RawProduct);
    console.log(`\n${card.title} | brand: ${card.brand ?? "none"} | image: ${card.imageUrl ? "yes" : "no"} | variant: ${card.offers[0]?.variantLabel ?? "none"}`);
    for (const [i, o] of (p.offers ?? []).entries()) {
      const n = card.offers[i];
      console.log(`  raw ${o.price.price} ${o.price.currency} (compare_at ${o.price.compare_at_price ?? "none"}) ${o.availability} ${o.domain} -> ${n ? `${n.priceCents} cents, inStock ${n.inStock}` : "dropped"}`);
    }
  }

  const first = page.data[0];
  if (!first) return;
  const again = await client.products.retrieve({ product_id: first.id }, { timeoutInSeconds: 20, maxRetries: 1 });
  console.log(`\nRetrieve ${first.id}: ${again.offers?.length ?? 0} offers, first price ${again.offers?.[0]?.price.price ?? "none"} ${again.offers?.[0]?.price.currency ?? ""}`);
  if (rawPath) {
    writeFileSync(rawPath, JSON.stringify(again, null, 2));
    console.log(`Raw product saved to ${rawPath}`);
  }
}

main().catch((e) => {
  const err = e as { statusCode?: number; message?: string };
  console.error(`Channel3 call failed: ${err.statusCode ?? ""} ${String(err.message ?? e).slice(0, 300)}`);
  process.exitCode = 1;
});
