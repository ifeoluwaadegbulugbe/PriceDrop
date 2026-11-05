/**
 * Looks up real Channel3 category slugs (free endpoint, no credits). Used to fill categories.channel3_slugs.
 *   npx tsx scripts/channel3-categories.ts
 */
import { Channel3 } from "@channel3/sdk";
import { config } from "dotenv";

config({ path: ".env.local" });

const TERMS = [
  "electronics", "smartphones", "tablets", "televisions", "audio", "cameras", "wearables",
  "clothing", "womens clothing", "mens clothing", "shoes", "bags", "accessories", "jewelry",
  "beauty", "skincare", "makeup", "hair care", "fragrance",
  "home", "furniture", "kitchen", "bedding", "home decor", "storage",
  "computers", "laptops", "computer accessories", "monitors",
  "appliances", "sports", "fitness", "video games", "gaming consoles",
  "baby", "kids", "toys", "books", "office supplies", "stationery", "automotive", "car accessories",
];

async function main() {
  const client = new Channel3({ apiKey: process.env.CHANNEL3_API_KEY });
  for (const query of TERMS) {
    const r = await client.categories.search({ query, limit: 4 }, { timeoutInSeconds: 15, maxRetries: 1 });
    console.log(`${query}: ${r.categories.map((c) => `${c.slug}[${(c.path ?? []).map((p) => p.slug).join(">")}]`).join(", ")}`);
  }
}

main().catch((e) => {
  console.error("failed", (e as { statusCode?: number }).statusCode, String((e as Error).message).slice(0, 200));
  process.exitCode = 1;
});
