/** All money is integer minor units. These are the only conversions. */

export function formatCents(cents: number, currency = "USD"): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const major = Math.trunc(abs / 100).toLocaleString("en-US");
  const minor = String(abs % 100).padStart(2, "0");
  const symbol = ({ USD: "$", GBP: "£", EUR: "€" } as Record<string, string>)[currency];
  return symbol ? `${sign}${symbol}${major}.${minor}` : `${sign}${major}.${minor} ${currency}`;
}

/** PayPal amount.value is a string. Integer arithmetic only, no float formatting. */
export function centsToPaypalValue(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new Error("invalid cents");
  return `${Math.trunc(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

/** Strict parse of "12.34", "12.3" or "12". Returns null for anything else. */
export function moneyStringToCents(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const m = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
}

/** Decimal number in major units (API response or form field) to cents. Null when not usable. */
export function majorToCents(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  const cents = Math.round(value * 100);
  return Number.isSafeInteger(cents) ? cents : null;
}
