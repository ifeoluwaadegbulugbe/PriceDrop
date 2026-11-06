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

export type PaypalAuthStatus = "ok" | "rejected" | "unexpected" | "unreachable";
export type PaypalAuthCheck = { status: PaypalAuthStatus; detail: string | null };

/** Why a request never got an answer, in a few words. Contains no credentials or payloads. */
export function networkReason(e: unknown): string {
  const err = e as { name?: string; message?: string; cause?: { code?: string; name?: string; message?: string } };
  const code = err?.cause?.code;
  if (err?.name === "TimeoutError" || err?.name === "AbortError" || err?.cause?.name === "TimeoutError") return "it took too long to respond";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "the address couldn't be found";
  if (code === "ECONNREFUSED" || code === "ECONNRESET" || code === "UND_ERR_SOCKET") return "the connection was dropped";
  if (code === "UND_ERR_CONNECT_TIMEOUT") return "it took too long to connect";
  if (/invalid url/i.test(err?.message ?? "") || /invalid url/i.test(err?.cause?.message ?? "")) return "the PayPal address is invalid";
  return code ? `connection error ${code}` : "the connection failed";
}

export interface PaypalApi {
  /** Asks PayPal for a token and reports the outcome. Creates nothing and returns no credentials. */
  checkAuth(): Promise<PaypalAuthCheck>;
  /** The PayPal host this client talks to. Not secret. */
  host: string;
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
  const baseUrl = (cfg.baseUrl ?? SANDBOX_BASE_URL).trim().replace(/\/+$/, "");
  assertSandboxUrl(baseUrl, cfg.allowLive === true);
  const doFetch = cfg.fetchImpl ?? fetch;
  let token: { value: string; expiresAt: number } | null = null;

  /**
   * One retry when no answer came back. Safe for orders and captures, because a repeated PayPal-Request-Id returns
   * the original result rather than creating a second one. An answer from PayPal, even an error, is never retried.
   */
  async function fetchWithRetry(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    try {
      return await doFetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (first) {
      if (/invalid url/i.test(String((first as Error).message))) throw first;
      return doFetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    }
  }

  async function accessToken(): Promise<string> {
    if (token && Date.now() < token.expiresAt) return token.value;
    const basic = Buffer.from(`${cfg.clientId.trim()}:${cfg.clientSecret.trim()}`).toString("base64");
    const res = await fetchWithRetry(`${baseUrl}/v1/oauth2/token`, {
      method: "POST",
      headers: { authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials",
    }, 15_000);
    // Only a 401 means the keys were refused. Anything else points at the address or at PayPal itself.
    if (!res.ok) throw new PaypalError(res.status, res.status === 401 ? "AUTHENTICATION_FAILURE" : `TOKEN_HTTP_${res.status}`, null, null);
    const data = (await res.json().catch(() => {
      throw new PaypalError(502, "MALFORMED_RESPONSE", null, null);
    })) as { access_token?: unknown; expires_in?: unknown };
    if (typeof data.access_token !== "string") throw new PaypalError(502, "MALFORMED_RESPONSE", null, null);
    const ttl = typeof data.expires_in === "number" ? data.expires_in : 300;
    token = { value: data.access_token, expiresAt: Date.now() + Math.max(ttl - 60, 30) * 1000 };
    return token.value;
  }

  async function call(method: string, path: string, opts: { body?: unknown; requestId?: string } = {}): Promise<unknown> {
    const res = await fetchWithRetry(`${baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${await accessToken()}`,
        "content-type": "application/json",
        prefer: "return=representation",
        ...(opts.requestId ? { "paypal-request-id": opts.requestId } : {}),
      },
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    }, 20_000);
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
    host: (() => {
      try {
        return new URL(baseUrl).hostname;
      } catch {
        return baseUrl;
      }
    })(),
    async checkAuth() {
      try {
        token = null;
        await accessToken();
        return { status: "ok", detail: null };
      } catch (e) {
        if (e instanceof PaypalError) {
          return e.paypalName === "AUTHENTICATION_FAILURE"
            ? { status: "rejected", detail: null }
            : { status: "unexpected", detail: e.paypalName };
        }
        return { status: "unreachable", detail: networkReason(e) };
      }
    },
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
