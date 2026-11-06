import { SANDBOX_BASE_URL, type PaypalAuthCheck } from "./client";

export type PaypalSetupStatus = { ok: boolean; message: string };

/** What's wrong with the PayPal setup, in words the site owner can act on. */
export function paypalSetupStatusFor(args: { auth: PaypalAuthCheck; host: string; appUrl: string; production: boolean }): PaypalSetupStatus {
  if (args.auth.status === "rejected") {
    return { ok: false, message: "PayPal rejected the client ID and secret. Copy both again from the Sandbox tab of your PayPal app, update them in Vercel, then redeploy." };
  }
  if (args.auth.status === "unexpected") {
    return { ok: false, message: `${args.host} answered, but not the way PayPal should (${args.auth.detail}). Set PAYPAL_BASE_URL in Vercel to ${SANDBOX_BASE_URL}, or delete it, then redeploy.` };
  }
  if (args.auth.status === "unreachable") {
    return { ok: false, message: `We couldn't reach PayPal at ${args.host}: ${args.auth.detail}. Refresh to try again. If this keeps happening, set PAYPAL_BASE_URL in Vercel to ${SANDBOX_BASE_URL}, or delete it, then redeploy.` };
  }
  let host = "";
  try {
    host = new URL(args.appUrl).hostname;
  } catch {
    // An unreadable address is handled like a missing one.
  }
  if (args.production && (host === "" || host === "localhost" || host === "127.0.0.1")) {
    return { ok: false, message: "Credentials work, but NEXT_PUBLIC_APP_URL isn't set to this site's address, so PayPal can't send shoppers back here. Set it in Vercel, then redeploy." };
  }
  return { ok: true, message: "Connected. PayPal accepted this site's sandbox credentials." };
}
