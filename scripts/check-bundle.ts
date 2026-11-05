/**
 * Proves no secret reaches client bundles. Builds with sentinel values, then searches .next/static for them.
 *   npm run test:bundle
 */
import { execSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const SECRETS: Record<string, string> = {
  SUPABASE_SERVICE_ROLE_KEY: "SENTINEL_SERVICE_ROLE_6f1c",
  CHANNEL3_API_KEY: "SENTINEL_CHANNEL3_8b2d",
  GEMINI_API_KEY: "SENTINEL_GEMINI_3a9e",
  PAYPAL_CLIENT_ID: "SENTINEL_PAYPAL_ID_77c1",
  PAYPAL_CLIENT_SECRET: "SENTINEL_PAYPAL_SECRET_44aa",
  PAYPAL_WEBHOOK_ID: "SENTINEL_WEBHOOK_90de",
  CRON_SECRET: "SENTINEL_CRON_12ff",
};
const PUBLIC = {
  NEXT_PUBLIC_SUPABASE_URL: "https://sentinel-public.example",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "SENTINEL_PUBLIC_ANON",
  NEXT_PUBLIC_APP_URL: "https://sentinel-app.example",
};

execSync("npx next build", { stdio: "inherit", env: { ...process.env, ...SECRETS, ...PUBLIC, NODE_ENV: "production" } });

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const files = walk(".next/static").filter((f) => /\.(js|css|html|json|map)$/.test(f));
const all = files.map((f) => readFileSync(f, "utf8")).join("\n");

let failed = 0;
const report = (name: string, ok: boolean) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failed++;
};
console.log(`Scanned ${files.length} client files`);
for (const [name, value] of Object.entries(SECRETS)) {
  report(`${name}: value not in client bundle`, !all.includes(value));
  report(`${name}: name not in client bundle`, !all.includes(name));
}
report("control: public anon key IS in the bundle (the scan can see inlined values)", all.includes(PUBLIC.NEXT_PUBLIC_SUPABASE_ANON_KEY));
const publicNames = new Set(all.match(/NEXT_PUBLIC_[A-Z_]+/g) ?? []);
console.log(`NEXT_PUBLIC names seen: ${[...publicNames].join(", ") || "none"}`);
process.exitCode = failed ? 1 : 0;
