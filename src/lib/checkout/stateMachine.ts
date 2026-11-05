import type { OrderStatus } from "@/lib/db/types";

/** Keep in step with enforce_paypal_order_transition() in the migrations. tests/db.test.ts checks every pair. */
export const TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  creating: ["created", "payer_action_required", "failed", "expired"],
  created: ["payer_action_required", "approved", "failed", "expired", "cancelled"],
  payer_action_required: ["approved", "captured", "failed", "expired", "cancelled"],
  approved: ["captured", "failed", "expired", "cancelled"],
  captured: [],
  failed: [],
  expired: [],
  cancelled: [],
};

export const ORDER_STATUSES = Object.keys(TRANSITIONS) as OrderStatus[];
export const LIVE_STATUSES: OrderStatus[] = ["creating", "created", "payer_action_required", "approved"];

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export class IllegalTransitionError extends Error {
  constructor(from: OrderStatus, to: OrderStatus) {
    super(`illegal order transition ${from} -> ${to}`);
    this.name = "IllegalTransitionError";
  }
}

export function assertTransition(from: OrderStatus, to: OrderStatus) {
  if (!canTransition(from, to)) throw new IllegalTransitionError(from, to);
}
