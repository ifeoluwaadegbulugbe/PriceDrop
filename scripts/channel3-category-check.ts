/**
 * Shows what each top-level category returns from Channel3. Costs 1 credit per category.
 *   npx tsx scripts/channel3-category-check.ts
 * Reads slugs and search terms straight from the migration, so it tests what actually ships.
 */
import { readFileSync } from "node:fs";
import { config } from "dotenv";
import { createChannel3Gateway } from "../src/lib/channel3/client";

config({ path: ".env.local" });

const sql = readFileSync("supabase/migrations/0003_shopping.sql", "utf8");
const block = sql.slice(sql.indexOf("insert into public.categories (slug"), sql.indexOf("insert into public.categories (parent_id"));
const rows = [...block.matchAll(/\('([a-z-]+)', '[^']+', '[^']*', '\{([^}]*)\}', '([^']+)'/g)];

async function main() {
  const c3 = createChannel3Gateway(process.env.CHANNEL3_API_KEY ?? "");
  for (const [, slug, slugs, query] of rows) {
    const cards = await c3.search({ query: query!, limit: 5, currency: "USD", categorySlugs: slugs!.split(",") });
    console.log(`\n${slug} [${slugs}] "${query}": ${cards.length}`);
    for (const p of cards.slice(0, 3)) console.log(`  ${p.brand ?? "-"} | ${p.title.slice(0, 60)} | $${(p.offers[0]?.priceCents ?? 0) / 100}`);
  }
}

main().catch((e) => {
  console.error("failed", (e as { statusCode?: number }).statusCode, String((e as Error).message).slice(0, 200));
  process.exitCode = 1;
});
