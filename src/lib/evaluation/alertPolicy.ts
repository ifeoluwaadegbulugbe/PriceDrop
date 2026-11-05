import { changeIsMeaningful, type Evaluation } from "./evaluate";

export type AlertLike = { status: string; price_cents: number };
export type AlertAction = "create" | "update" | "expire" | "none";

/**
 * Whether a check creates, refreshes or retires the alert for one (tracked product, domain).
 * liveAlert is the 'open' or 'checkout_prepared' alert. lastAlert is the most recent alert of any status.
 */
export function decideAlert(args: {
  evaluation: Evaluation;
  priceCents: number;
  previousCents: number | null;
  liveAlert: AlertLike | null;
  lastAlert: AlertLike | null;
}): AlertAction {
  const { evaluation, priceCents, previousCents, liveAlert, lastAlert } = args;
  const qualifies = evaluation.decision === "qualifies";

  if (liveAlert) {
    if (liveAlert.status !== "open") return "none"; // a checkout is in flight; prepare re-checks
    if (!qualifies) return "expire";
    const lower = priceCents < liveAlert.price_cents && changeIsMeaningful(liveAlert.price_cents, priceCents);
    return lower ? "update" : "none";
  }

  if (!qualifies) return "none";
  // Sub-threshold jitter never creates an alert. An unchanged price can: that means the rules were edited.
  if (previousCents !== null && previousCents !== priceCents && !evaluation.meetsChangeThreshold) return "none";

  if (!lastAlert) return "create";
  if (lastAlert.status === "expired") return "create";
  if (lastAlert.status === "dismissed") {
    // The buyer said no at that price. Only a meaningfully lower price earns a new alert.
    return priceCents < lastAlert.price_cents && changeIsMeaningful(lastAlert.price_cents, priceCents)
      ? "create"
      : "none";
  }
  return "none"; // purchased
}
