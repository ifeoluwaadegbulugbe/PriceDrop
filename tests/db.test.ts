import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { canTransition, ORDER_STATUSES } from "@/lib/checkout/stateMachine";
import { createDb } from "../scripts/local/stack";

let db: PGlite;

beforeAll(async () => {
  db = await createDb();
  await db.query(`insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000001', 'a@example.com')`);
  await db.query(`insert into public.products (id, source, external_id, title) values ('00000000-0000-0000-0000-0000000000aa', 'seed', 'x', 't')`);
  await db.query(`insert into public.tracked_products (id, user_id, product_id, target_price_cents, max_total_cents)
    values ('00000000-0000-0000-0000-0000000000bb', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000aa', 100, 200)`);
  await db.query(`insert into public.price_observations (id, tracked_product_id, domain, price_cents, currency, source)
    overriding system value values (1, '00000000-0000-0000-0000-0000000000bb', 'd', 90, 'USD', 'seed')`);
  await db.query(`insert into public.deal_alerts (id, tracked_product_id, user_id, observation_id, domain, price_cents, evaluation, explanation, explanation_source)
    values ('00000000-0000-0000-0000-0000000000cc', '00000000-0000-0000-0000-0000000000bb', '00000000-0000-0000-0000-000000000001', 1, 'd', 90, '{}', 'x', 'template')`);
});
afterAll(async () => db.close());

async function insertOrder(status: string): Promise<string> {
  // Bypass the one-live-order index by retiring earlier rows.
  await db.query(`delete from public.paypal_orders`);
  const r = await db.query<{ id: string }>(
    `insert into public.paypal_orders (user_id, deal_alert_id, idempotency_key, amount_cents, currency, status, expires_at)
     values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000cc', gen_random_uuid()::text, 90, 'USD', $1, now()) returning id`,
    [status],
  );
  return r.rows[0]!.id;
}

describe("order state machine", () => {
  it("TypeScript and the database trigger agree on every pair of states", async () => {
    for (const from of ORDER_STATUSES) {
      for (const to of ORDER_STATUSES) {
        if (from === to) continue;
        const id = await insertOrder(from);
        const ok = await db
          .query(`update public.paypal_orders set status = $1 where id = $2`, [to, id])
          .then(() => true, () => false);
        expect(`${from}->${to}:${ok}`).toBe(`${from}->${to}:${canTransition(from, to)}`);
      }
    }
  }, 120000);

  it("terminal states have no way out", () => {
    for (const from of ["captured", "failed", "expired", "cancelled"] as const) {
      expect(ORDER_STATUSES.filter((to) => canTransition(from, to))).toEqual([]);
    }
  });
});

describe("indexes", () => {
  it("one live order per alert", async () => {
    await insertOrder("payer_action_required");
    await expect(
      db.query(`insert into public.paypal_orders (user_id, deal_alert_id, idempotency_key, amount_cents, currency, status, expires_at)
        values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000cc', 'other', 90, 'USD', 'approved', now())`),
    ).rejects.toThrow(/duplicate key/);
  });
  it("one live alert per product and domain", async () => {
    await expect(
      db.query(`insert into public.deal_alerts (tracked_product_id, user_id, observation_id, domain, price_cents, evaluation, explanation, explanation_source)
        values ('00000000-0000-0000-0000-0000000000bb', '00000000-0000-0000-0000-000000000001', 1, 'd', 80, '{}', 'x', 'template')`),
    ).rejects.toThrow(/duplicate key/);
  });
  it("rejects target above max and non-positive target", async () => {
    await expect(db.query(`update public.tracked_products set target_price_cents = 300`)).rejects.toThrow(/check/);
    await expect(db.query(`update public.tracked_products set target_price_cents = 0`)).rejects.toThrow(/check/);
  });
});

describe("bump_counter", () => {
  it("stops at the limit", async () => {
    const bump = async () => (await db.query<{ ok: boolean }>(`select public.bump_counter('t', 2) as ok`)).rows[0]!.ok;
    expect(await bump()).toBe(true);
    expect(await bump()).toBe(true);
    expect(await bump()).toBe(false);
    expect(await bump()).toBe(false);
  });
});
