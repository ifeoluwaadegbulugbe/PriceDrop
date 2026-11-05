import "server-only";
import { createChannel3Gateway } from "@/lib/channel3/client";
import { createGeminiProvider, type LlmCaller } from "@/lib/ai/provider";
import type { Deps } from "@/lib/deps";
import { getEnv, isPaypalConfigured } from "@/lib/env";
import { createPaypalClient } from "@/lib/paypal/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { bumpCounter } from "@/lib/usage";

let paypalSingleton: Deps["paypal"] = null;

export function getDeps(): Deps {
  const env = getEnv();
  const db = createAdminClient();

  if (!paypalSingleton && isPaypalConfigured()) {
    paypalSingleton = createPaypalClient({
      clientId: env.PAYPAL_CLIENT_ID!,
      clientSecret: env.PAYPAL_CLIENT_SECRET!,
      baseUrl: env.PAYPAL_BASE_URL,
      allowLive: env.ALLOW_LIVE_PAYPAL,
    });
  }

  const provider =
    env.LLM_ENABLED && env.GEMINI_API_KEY ? createGeminiProvider(env.GEMINI_API_KEY, env.GEMINI_MODEL) : null;

  const callLlm: LlmCaller = async (req) => {
    if (!provider) return null;
    try {
      const day = new Date().toISOString().slice(0, 10);
      if (!(await bumpCounter(db, `budget:llm:${day}`, env.LLM_DAILY_CAP))) return null;
      return await provider.generate(req);
    } catch {
      return null; // basic mode. Deliberately no detail: prompts and responses are not logged.
    }
  };

  return {
    db,
    channel3: env.CHANNEL3_API_KEY ? createChannel3Gateway(env.CHANNEL3_API_KEY) : null,
    paypal: paypalSingleton,
    callLlm,
    channel3Budget: env.CHANNEL3_MONTHLY_BUDGET,
    demoMode: env.DEMO_MODE,
    appUrl: env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, ""),
    now: () => new Date(),
  };
}
