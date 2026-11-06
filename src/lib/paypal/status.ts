import "server-only";
import type { Deps } from "@/lib/deps";
import { paypalSetupStatusFor, type PaypalSetupStatus } from "./statusMessage";

export async function paypalSetupStatus(deps: Deps): Promise<PaypalSetupStatus> {
  if (!deps.paypal) return { ok: false, message: "PayPal sandbox isn't set up on this deployment." };
  return paypalSetupStatusFor({
    auth: await deps.paypal.checkAuth(),
    host: deps.paypal.host,
    appUrl: deps.appUrl,
    production: process.env.VERCEL === "1",
  });
}
