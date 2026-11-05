/**
 * Typed fetch client for PayPal Orders v2, per developer.paypal.com. Sandbox only unless ALLOW_LIVE_PAYPAL=true,
 * which must never be set. Never logs tokens, secrets or raw payloads.
 */
import { centsToPaypalValue, moneyStringToCents } from "@/lib/money";

export const SANDBOX_BASE_URL = "https://api-m.sandbox.paypal.com";

export class PaypalError extends Error {
  constructor(
    public readonly status: number,
    public readonly paypalName: string,
    public readonly issue: string | null,
    public readonly debugId: string | null,
  ) {
    super(`PayPal error ${status} ${paypalName}${issue ? ` ${issue}` : ""}`);
    this.name = "PaypalError";
  }
}

export class PaypalLiveEndpointError extends Error {
  constructor() {
    super("Refusing to run: PAYPAL_BASE_URL is not a sandbox endpoint.");
    this.name = "PaypalLiveEndpointError";
  }
}

/** Throws unless the base URL is a sandbox endpoint. A local emulator must have 'sandbox' in its path. */
export function assertSandboxUrl(baseUrl: string, allowLive: boolean) {
  if (allowLive) return;
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new PaypalLiveEndpointError();
  }
  const host = url.hostname.toLowerCase();
  const isLocal = host === "localhost" || host === "127.0.0.1";
  const ok = host.split(".").includes("sandbox") || (isLocal && url.pathname.includes("sandbox"));
  if (!ok) throw new PaypalLiveEndpointError();
}

export type PaypalCapture = {
  id: string;
  status: string;
  amountCents: number | null;
  currency: string | null;
};
export type PaypalOrder = {
  id: string;
  status: string;
  payerActionUrl: string | null;
  amountCents: number | null;
  currency: string | null;
  captures: PaypalCapture[];
};

export interface PaypalApi {
  createOrder(args: {
    amountCents: number;
    currency: string;
    requestId: string;
    returnUrl: string;
    cancelUrl: string;
    customId: string;
  }): Promise<PaypalOrder>;
  getOrder(id: string): Promise<PaypalOrder>;
  captureOrder(id: string, requestId: string): Promise<PaypalOrder>;
  verifyWebhookSignature(args: { headers: Headers; event: unknown; webhookId: string }): Promise<boolean>;
}

type RawMoney = { value?: unknown; currency_code?: unknown };
type RawOrder = {
  id?: unknown;
  status?: unknown;
  links?: { rel?: unknown; href?: unknown }[];
  purchase_units?: {
    amount?: RawMoney;
    payments?: { captures?: { id?: unknown; status?: unknown; amount?: RawMoney }[] };
  }[];
};

export function parseOrder(raw: RawOrder): PaypalOrder {
  if (typeof raw?.id !== "string" || typeof raw?.status !== "string") {
    throw new PaypalError(502, "MALFORMED_RESPONSE", null, null);
  }
  const unit = raw.purchase_units?.[0];
  const link = raw.links?.find((l) => l.rel === "payer-action")?.href;
  const captures = unit?.payments?.captures ?? [];
  return {
    id: raw.id,
    status: raw.status,
    payerActionUrl: typeof link === "string" ? link : null,
    amountCents: moneyStringToCents(unit?.amount?.value),
    currency: typeof unit?.amount?.currency_code === "string" ? unit.amount.currency_code : null,
    captures: captures.flatMap((c) =>
      typeof c.id === "string" && typeof c.status === "string"
        ? [{
            id: c.id,
            status: c.status,
            amountCents: moneyStringToCents(c.amount?.value),
            currency: typeof c.amount?.currency_code === "string" ? c.amount.currency_code : null,
          }]
        : [],
    ),
  };
}

export function createPaypalClient(cfg: {
  clientId: string;
  clientSecret: string;
  baseUrl?: string;
  allowLive?: boolean;
  fetchImpl?: typeof fetch;
}): PaypalApi {
  const baseUrl = (cfg.baseUrl ?? SANDBOX_BASE_URL).replace(/\/+$/, "");
  assertSandboxUrl(baseUrl, cfg.allowLive === true);
  const doFetch = cfg.fetchImpl ?? fetch;
  let token: { value: string; expiresAt: number } | null = null;

  async function accessToken(): Promise<string> {
    if (token && Date.now() < token.expiresAt) return token.value;
    const basic = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64");
    const res = await doFetch(`${baseUrl}/v1/oauth2/token`, {
      method: "POST",
      headers: { authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials",
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new PaypalError(res.status, "AUTHENTICATION_FAILURE", null, null);
    const data = (await res.json()) as { access_token?: unknown; expires_in?: unknown };
    if (typeof data.access_token !== "string") throw new PaypalError(502, "MALFORMED_RESPONSE", null, null);
    const ttl = typeof data.expires_in === "number" ? data.expires_in : 300;
    token = { value: data.access_token, expiresAt: Date.now() + Math.max(ttl - 60, 30) * 1000 };
    return token.value;
  }

  async function call(method: string, path: string, opts: { body?: unknown; requestId?: string } = {}): Promise<unknown> {
    const res = await doFetch(`${baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${await accessToken()}`,
        "content-type": "application/json",
        prefer: "return=representation",
        ...(opts.requestId ? { "paypal-request-id": opts.requestId } : {}),
      },
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
      signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!res.ok) {
      const e = (data ?? {}) as { name?: unknown; debug_id?: unknown; details?: { issue?: unknown }[] };
      throw new PaypalError(
        res.status,
        typeof e.name === "string" ? e.name : "UNKNOWN_ERROR",
        typeof e.details?.[0]?.issue === "string" ? e.details[0].issue : null,
        typeof e.debug_id === "string" ? e.debug_id : null,
      );
    }
    return data;
  }

  return {
    async createOrder({ amountCents, currency, requestId, returnUrl, cancelUrl, customId }) {
      const raw = await call("POST", "/v2/checkout/orders", {
        requestId,
        body: {
          intent: "CAPTURE",
          purchase_units: [
            {
              custom_id: customId,
              description: "PriceDrop sandbox checkout",
              amount: { currency_code: currency, value: centsToPaypalValue(amountCents) },
            },
          ],
          payment_source: {
            paypal: {
              experience_context: {
                return_url: returnUrl,
                cancel_url: cancelUrl,
                user_action: "PAY_NOW",
                shipping_preference: "NO_SHIPPING",
                brand_name: "PriceDrop (sandbox)",
              },
            },
          },
        },
      });
      return parseOrder(raw as RawOrder);
    },
    async getOrder(id) {
      if (!/^[A-Z0-9]{1,36}$/.test(id)) throw new PaypalError(400, "INVALID_ORDER_ID", null, null);
      return parseOrder((await call("GET", `/v2/checkout/orders/${id}`)) as RawOrder);
    },
    async captureOrder(id, requestId) {
      if (!/^[A-Z0-9]{1,36}$/.test(id)) throw new PaypalError(400, "INVALID_ORDER_ID", null, null);
      return parseOrder((await call("POST", `/v2/checkout/orders/${id}/capture`, { requestId, body: {} })) as RawOrder);
    },
    async verifyWebhookSignature({ headers, event, webhookId }) {
      const fields = {
        auth_algo: headers.get("paypal-auth-algo"),
        cert_url: headers.get("paypal-cert-url"),
        transmission_id: headers.get("paypal-transmission-id"),
        transmission_sig: headers.get("paypal-transmission-sig"),
        transmission_time: headers.get("paypal-transmission-time"),
      };
      if (Object.values(fields).some((v) => !v)) return false;
      const data = (await call("POST", "/v1/notifications/verify-webhook-signature", {
        body: { ...fields, webhook_id: webhookId, webhook_event: event },
      })) as { verification_status?: unknown };
      return data?.verification_status === "SUCCESS";
    },
  };
}
