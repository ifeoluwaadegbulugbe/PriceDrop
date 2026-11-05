import type { SupabaseClient } from "@supabase/supabase-js";
import type { Channel3Gateway } from "@/lib/channel3/client";
import type { LlmCaller } from "@/lib/ai/provider";
import type { PaypalApi } from "@/lib/paypal/client";

/**
 * Everything a service touches outside itself. Passed in so the same logic runs in routes, in the monitor,
 * and in tests against the emulator. `db` is the service-role client: services must verify ownership themselves.
 */
export type Deps = {
  db: SupabaseClient;
  channel3: Channel3Gateway | null;
  paypal: PaypalApi | null;
  callLlm: LlmCaller;
  channel3Budget: number;
  demoMode: boolean;
  appUrl: string;
  now: () => Date;
};
