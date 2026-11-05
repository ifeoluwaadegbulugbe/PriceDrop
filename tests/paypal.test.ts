import { describe, expect, it, vi } from "vitest";
import { centsToPaypalValue, majorToCents, moneyStringToCents } from "@/lib/money";
import { assertSandboxUrl, createPaypalClient, PaypalError, PaypalLiveEndpointError } from "@/lib/paypal/client";
import { normalizeProduct } from "@/lib/channel3/normalize";
import fixture from "./fixtures/channel3-product.synthetic.json";

describe("money", () => {
  it("formats PayPal values with integers only", () => {
    expect(centsToPaypalValue(9000)).toBe("90.00");
    expect(centsToPaypalValue(1)).toBe("0.01");
    expect(centsToPaypalValue(129999)).toBe("1299.99");
    expect(() => centsToPaypalValue(1.5)).toThrow();
    expect(() => centsToPaypalValue(-1)).toThrow();
  });
  it("parses strictly", () => {
    expect(moneyStringToCents("90.00")).toBe(9000);
    expect(moneyStringToCents("0.1")).toBe(10);
    expect(moneyStringToCents("90")).toBe(9000);
    for (const bad of ["90.001", "-1", "1e3", "abc", "", 90, null]) expect(moneyStringToCents(bad)).toBeNull();
  });
  it("converts decimals without float drift", () => {
    expect(majorToCents(19.99)).toBe(1999);
    expect(majorToCents(1.1)).toBe(110);
    expect(majorToCents(-1)).toBeNull();
    expect(majorToCents(Number.NaN)).toBeNull();
  });
});

describe("live endpoint guard", () => {
  it("accepts sandbox", () => {
    expect(() => assertSandboxUrl("https://api-m.sandbox.paypal.com", false)).not.toThrow();
    expect(() => assertSandboxUrl("http://127.0.0.1:54399/paypal-sandbox", false)).not.toThrow();
  });
  it("refuses live and look-alikes", () => {
    for (const url of [
      "https://api-m.paypal.com",
      "https://api.paypal.com",
      "https://api-m.paypal.com/sandbox",
      "https://notsandbox.paypal.com",
      "not a url",
    ]) {
      expect(() => assertSandboxUrl(url, false)).toThrow(PaypalLiveEndpointError);
    }
  });
  it("the client refuses to construct against live", () => {
    expect(() => createPaypalClient({ clientId: "a", clientSecret: "b", baseUrl: "https://api-m.paypal.com" })).toThrow(PaypalLiveEndpointError);
  });
});

function fakeFetch(handler: (url: string, init: RequestInit) => Response) {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith("/v1/oauth2/token")) return Response.json({ access_token: "tok", expires_in: 3600 });
    return handler(u, init ?? {});
  }) as unknown as typeof fetch;
}

describe("paypal client", () => {
  const args = { amountCents: 8999, currency: "USD", requestId: "req-1", returnUrl: "https://a/r", cancelUrl: "https://a/c", customId: "row" };

  it("creates an order with documented fields and reads the payer-action link", async () => {
    let body: Record<string, unknown> = {};
    let headers: Record<string, string> = {};
    const client = createPaypalClient({
      clientId: "id", clientSecret: "secret",
      fetchImpl: fakeFetch((_u, init) => {
        body = JSON.parse(String(init.body));
        headers = init.headers as Record<string, string>;
        return Response.json({ id: "ORDER1", status: "PAYER_ACTION_REQUIRED", links: [{ rel: "payer-action", href: "https://pp/approve" }] }, { status: 200 });
      }),
    });
    const order = await client.createOrder(args);
    expect(order.payerActionUrl).toBe("https://pp/approve");
    expect(headers["paypal-request-id"]).toBe("req-1");
    expect(body).toMatchObject({
      intent: "CAPTURE",
      purchase_units: [{ amount: { currency_code: "USD", value: "89.99" } }],
      payment_source: { paypal: { experience_context: { return_url: "https://a/r", cancel_url: "https://a/c", user_action: "PAY_NOW" } } },
    });
  });

  it("caches the token", async () => {
    const f = fakeFetch(() => Response.json({ id: "O", status: "APPROVED" }));
    const client = createPaypalClient({ clientId: "id", clientSecret: "s", fetchImpl: f });
    await client.getOrder("ORDER1");
    await client.getOrder("ORDER2");
    const tokenCalls = (f as unknown as { mock: { calls: unknown[][] } }).mock.calls.filter((c) => String(c[0]).endsWith("/oauth2/token"));
    expect(tokenCalls.length).toBe(1);
  });

  it("turns PayPal errors into typed errors with no secrets", async () => {
    const client = createPaypalClient({
      clientId: "id", clientSecret: "super-secret",
      fetchImpl: fakeFetch(() => Response.json({ name: "UNPROCESSABLE_ENTITY", debug_id: "d1", details: [{ issue: "ORDER_NOT_APPROVED" }] }, { status: 422 })),
    });
    const err = await client.captureOrder("ORDER1", "r").catch((e) => e);
    expect(err).toBeInstanceOf(PaypalError);
    expect(err.issue).toBe("ORDER_NOT_APPROVED");
    expect(String(err.message)).not.toContain("super-secret");
    expect(String(err.message)).not.toContain("tok");
  });

  it("rejects order ids that aren't PayPal-shaped before calling", async () => {
    const f = fakeFetch(() => Response.json({}));
    const client = createPaypalClient({ clientId: "id", clientSecret: "s", fetchImpl: f });
    await expect(client.getOrder("../../v1/x")).rejects.toBeInstanceOf(PaypalError);
  });

  it("parses capture path and status", async () => {
    const client = createPaypalClient({
      clientId: "id", clientSecret: "s",
      fetchImpl: fakeFetch(() => Response.json({ id: "O", status: "COMPLETED", purchase_units: [{ payments: { captures: [{ id: "C1", status: "COMPLETED", amount: { value: "89.99", currency_code: "USD" } }] } }] })),
    });
    const o = await client.captureOrder("O", "r");
    expect(o.captures[0]).toEqual({ id: "C1", status: "COMPLETED", amountCents: 8999, currency: "USD" });
  });

  it("webhook verification requires SUCCESS and all headers", async () => {
    const h = new Headers({
      "paypal-auth-algo": "a", "paypal-cert-url": "https://c", "paypal-transmission-id": "i",
      "paypal-transmission-sig": "s", "paypal-transmission-time": "t",
    });
    const ok = createPaypalClient({ clientId: "i", clientSecret: "s", fetchImpl: fakeFetch(() => Response.json({ verification_status: "SUCCESS" })) });
    expect(await ok.verifyWebhookSignature({ headers: h, event: {}, webhookId: "w" })).toBe(true);
    const bad = createPaypalClient({ clientId: "i", clientSecret: "s", fetchImpl: fakeFetch(() => Response.json({ verification_status: "FAILURE" })) });
    expect(await bad.verifyWebhookSignature({ headers: h, event: {}, webhookId: "w" })).toBe(false);
    expect(await ok.verifyWebhookSignature({ headers: new Headers(), event: {}, webhookId: "w" })).toBe(false);
  });
});

describe("channel3 normalize (synthetic fixture)", () => {
  const card = normalizeProduct(fixture as never);
  it("maps fields per the SDK types", () => {
    expect(card).toMatchObject({ id: "synthetic-1", source: "channel3", title: "Sony WH-CH520", brand: "Sony" });
    expect(card.imageUrl).toBe("https://images.example/clean.png");
  });
  it("converts prices and availability, and has no shipping data", () => {
    expect(card.offers[0]).toMatchObject({ domain: "shop.example", priceCents: 7999, currency: "USD", inStock: true, shippingCents: null, variantLabel: "Black" });
    expect(card.offers[1]).toMatchObject({ inStock: false });
  });
  it("drops malformed offers and unsafe URLs", () => {
    expect(card.offers.length).toBe(3);
    expect(card.offers[2]!.url).toBeNull();
  });
});
