export function timeAgo(iso: string | null | undefined, now = new Date()): string {
  if (!iso) return "never";
  const seconds = Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export function dateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC";
}

/** "12.34" or "12" to cents. Null when not a positive amount. Integer arithmetic. */
export function parseMoneyInput(raw: string): number | null {
  const m = /^\s*(\d{1,9})(?:\.(\d{1,2}))?\s*$/.exec(raw.replace(/,/g, ""));
  if (!m) return null;
  const cents = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  return cents > 0 ? cents : null;
}

export function centsToInput(cents: number | null | undefined): string {
  if (!cents) return "";
  return `${Math.trunc(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}
