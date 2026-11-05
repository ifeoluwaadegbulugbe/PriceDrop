/**
 * The decision. Pure, deterministic, integer-only. No LLM output reaches this function
 * except numbers a person confirmed. Fails closed on malformed input.
 */

export type EvalOffer = {
  domain: string;
  priceCents: number;
  shippingCents: number | null;
  currency: string;
  inStock: boolean | null;
  variantLabel: string | null;
};

export type EvalRules = {
  currency: string;
  targetPriceCents: number;
  maxTotalCents: number;
  allowedDomains: string[];
  allowedVariants: string[] | null;
  requireInStock: boolean;
};

export type EvalPrevious = { priceCents: number; currency: string } | null;

export type CheckId =
  | "price_valid" | "currency" | "target_price" | "max_total" | "domain" | "variant" | "in_stock";
export type UnknownId = "shipping_unknown" | "variant_unknown" | "stock_unknown";

export type Decision = "qualifies" | "does_not_qualify" | "insufficient_info";
export type RecommendedAction = "prepare_checkout" | "keep_watching" | "review_missing_info";

export type Evaluation = {
  decision: Decision;
  passed: CheckId[];
  failed: CheckId[];
  unknown: UnknownId[];
  /** target minus price. Positive means below target. */
  priceDifferenceCents: number;
  savingsVsPreviousCents: number | null;
  /** True only when a previous observation exists and is strictly higher. */
  isGenuineChange: boolean;
  /** False for moves smaller than max(1%, 1 minor unit) vs the previous observation. */
  meetsChangeThreshold: boolean;
  recommendedAction: RecommendedAction;
  /** Price plus shipping when known, price alone when shipping is unknown. Null on invalid input. */
  knownTotalCents: number | null;
};

export function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/^www\./, "");
}

const validAmount = (n: unknown): n is number =>
  typeof n === "number" && Number.isSafeInteger(n) && n >= 0;

export function changeIsMeaningful(previousCents: number, currentCents: number): boolean {
  const move = Math.abs(previousCents - currentCents);
  return move >= 1 && move * 100 >= previousCents;
}

export function evaluateDeal(offer: EvalOffer, rules: EvalRules, previous: EvalPrevious): Evaluation {
  const passed: CheckId[] = [];
  const failed: CheckId[] = [];
  const unknown: UnknownId[] = [];

  const priceOk = validAmount(offer.priceCents);
  const shippingOk = offer.shippingCents === null || validAmount(offer.shippingCents);
  if (priceOk && shippingOk) passed.push("price_valid");
  else failed.push("price_valid");
  const price = priceOk ? offer.priceCents : 0;

  if (offer.currency === rules.currency) passed.push("currency");
  else failed.push("currency");

  if (priceOk && price <= rules.targetPriceCents) passed.push("target_price");
  else failed.push("target_price");

  let knownTotal: number | null = null;
  if (priceOk && shippingOk) {
    if (offer.shippingCents === null) {
      knownTotal = price;
      unknown.push("shipping_unknown");
      // Unknown shipping is never a pass. It only fails when price alone already exceeds max.
      if (price > rules.maxTotalCents) failed.push("max_total");
    } else {
      knownTotal = price + offer.shippingCents;
      if (knownTotal <= rules.maxTotalCents) passed.push("max_total");
      else failed.push("max_total");
    }
  } else {
    failed.push("max_total");
  }

  const allowed = rules.allowedDomains.map(normalizeDomain);
  if (allowed.length === 0 || allowed.includes(normalizeDomain(offer.domain))) passed.push("domain");
  else failed.push("domain");

  if (rules.allowedVariants && rules.allowedVariants.length > 0) {
    if (offer.variantLabel === null) unknown.push("variant_unknown");
    else if (rules.allowedVariants.includes(offer.variantLabel)) passed.push("variant");
    else failed.push("variant");
  } else {
    passed.push("variant");
  }

  if (rules.requireInStock) {
    if (offer.inStock === null) unknown.push("stock_unknown");
    else if (offer.inStock === true) passed.push("in_stock");
    else failed.push("in_stock");
  } else {
    passed.push("in_stock");
  }

  const prev = previous !== null && validAmount(previous.priceCents) && previous.currency === offer.currency && priceOk
    ? previous
    : null;
  const isGenuineChange = prev !== null && prev.priceCents > price;
  const savingsVsPreviousCents = prev !== null ? prev.priceCents - price : null;
  const meetsChangeThreshold = prev !== null ? changeIsMeaningful(prev.priceCents, price) : true;

  // Retailer data rarely states shipping (Channel3 has no shipping field at all), so unknown shipping
  // alone does not block a deal: it stays listed as unknown, is shown to the buyer, and checkout charges
  // the known price only. Any other unknown does block. See docs/UNVERIFIED.md.
  const blockingUnknown = unknown.some((u) => u !== "shipping_unknown");
  const decision: Decision =
    failed.length > 0 ? "does_not_qualify" : blockingUnknown ? "insufficient_info" : "qualifies";

  return {
    decision,
    passed,
    failed,
    unknown,
    priceDifferenceCents: rules.targetPriceCents - price,
    savingsVsPreviousCents,
    isGenuineChange,
    meetsChangeThreshold,
    recommendedAction:
      decision === "qualifies" ? "prepare_checkout"
      : decision === "insufficient_info" ? "review_missing_info" : "keep_watching",
    knownTotalCents: knownTotal,
  };
}
