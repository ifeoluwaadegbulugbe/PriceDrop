import { z } from "zod";

// Values pasted into a dashboard often carry a stray space or line break, so every value is trimmed.
const blank = (v: unknown) => (typeof v === "string" ? v.trim() || undefined : v);
const boolFlag = z.preprocess(blank, z.string().optional()).transform((v) => v === "true");
const optionalString = z.preprocess(blank, z.string().optional());

const schema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.preprocess(blank, z.url().optional()),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: optionalString,
  // Supabase's current docs name this the publishable key. Either works.
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: optionalString,
  SUPABASE_SERVICE_ROLE_KEY: optionalString,
  NEXT_PUBLIC_APP_URL: z.preprocess(blank, z.url().default("http://localhost:3000")),
  CHANNEL3_API_KEY: optionalString,
  CHANNEL3_MONTHLY_BUDGET: z.preprocess(blank, z.coerce.number().int().min(0).default(300)),
  GEMINI_API_KEY: optionalString,
  GEMINI_MODEL: z.preprocess(blank, z.string().default("gemini-3.5-flash-lite")),
  LLM_ENABLED: boolFlag,
  LLM_DAILY_CAP: z.preprocess(blank, z.coerce.number().int().min(0).default(100)),
  PAYPAL_CLIENT_ID: optionalString,
  PAYPAL_CLIENT_SECRET: optionalString,
  PAYPAL_BASE_URL: z.preprocess(blank, z.url().default("https://api-m.sandbox.paypal.com")),
  PAYPAL_WEBHOOK_ID: optionalString,
  ALLOW_LIVE_PAYPAL: boolFlag,
  CRON_SECRET: optionalString,
  DEMO_MODE: boolFlag,
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

/** Server only. A malformed value throws a clear error naming the variable, never its value. */
export function getEnv(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const names = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment configuration. ${names}`);
  }
  cached = parsed.data;
  return cached;
}

export function supabaseAnonKey(): string | undefined {
  const e = getEnv();
  return e.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? e.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
}

export function isSupabaseConfigured(): boolean {
  const e = getEnv();
  return Boolean(e.NEXT_PUBLIC_SUPABASE_URL && supabaseAnonKey() && e.SUPABASE_SERVICE_ROLE_KEY);
}

export function isPaypalConfigured(): boolean {
  const e = getEnv();
  return Boolean(e.PAYPAL_CLIENT_ID && e.PAYPAL_CLIENT_SECRET);
}
