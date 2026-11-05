import type { Evaluation } from "@/lib/evaluation/evaluate";

export type ProfileRow = {
  id: string;
  display_name: string | null;
  currency: string;
  notify_in_app: boolean;
  onboarded: boolean;
  created_at: string;
};
export type ProductRow = {
  id: string;
  source: "channel3" | "seed";
  external_id: string;
  title: string;
  brand: string | null;
  image_url: string | null;
  fetched_at: string;
};
export type TrackedStatus = "active" | "paused" | "deal_found" | "purchased" | "removed";
export type TrackedRow = {
  id: string;
  user_id: string;
  product_id: string;
  status: TrackedStatus;
  currency: string;
  target_price_cents: number;
  max_total_cents: number;
  allowed_domains: string[];
  allowed_variants: string[] | null;
  require_in_stock: boolean;
  last_checked_at: string | null;
  last_check_status: string | null;
  created_at: string;
};
export type ObservationSource = "channel3_live" | "seed" | "demo_simulation";
export type ObservationRow = {
  id: number;
  tracked_product_id: string;
  domain: string;
  offer_url: string | null;
  price_cents: number;
  shipping_cents: number | null;
  currency: string;
  in_stock: boolean | null;
  source: ObservationSource;
  is_baseline: boolean;
  observed_at: string;
};
export type AlertStatus = "open" | "checkout_prepared" | "purchased" | "dismissed" | "expired";
export type AlertRow = {
  id: string;
  tracked_product_id: string;
  user_id: string;
  observation_id: number;
  domain: string;
  price_cents: number;
  previous_price_cents: number | null;
  evaluation: Evaluation;
  explanation: string;
  explanation_source: "llm" | "template";
  status: AlertStatus;
  created_at: string;
};
export type NotificationRow = {
  id: string;
  user_id: string;
  kind: "deal_found" | "tracking_status" | "payment_status";
  title: string;
  body: string;
  link: string | null;
  read_at: string | null;
  created_at: string;
};
export type OrderStatus =
  | "creating" | "created" | "payer_action_required" | "approved"
  | "captured" | "failed" | "expired" | "cancelled";
export type OrderRow = {
  id: string;
  user_id: string;
  deal_alert_id: string;
  paypal_order_id: string | null;
  idempotency_key: string;
  amount_cents: number;
  currency: string;
  status: OrderStatus;
  approve_url: string | null;
  expires_at: string;
  paypal_capture_id: string | null;
  failure_reason: string | null;
  created_at: string;
  updated_at: string;
};
export type PurchaseRow = {
  id: string;
  user_id: string;
  paypal_order_row: string;
  product_id: string;
  retailer_domain: string;
  amount_cents: number;
  currency: string;
  paypal_order_id: string;
  paypal_capture_id: string;
  is_sandbox: boolean;
  refunded_at: string | null;
  purchased_at: string;
};
export type ActivityRow = {
  id: number;
  user_id: string;
  tracked_product_id: string | null;
  agent: "intent" | "discovery" | "evaluation" | "monitoring" | "purchase";
  action: string;
  input_summary: Record<string, unknown> | null;
  output_summary: Record<string, unknown> | null;
  status: string;
  created_at: string;
};
