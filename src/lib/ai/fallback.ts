import { z } from "zod";

export const intentSchema = z.object({
  product: z.string().min(1).max(160),
  brand: z.string().min(1).max(60).optional(),
  maxPriceCents: z.number().int().positive().optional(),
  currency: z.string().length(3),
  preferences: z.array(z.string().max(60)).max(10),
  needsClarification: z.string().max(200).optional(),
});
export type Intent = z.infer<typeof intentSchema>;

export const KNOWN_BRANDS = [
  "Sony", "Bose", "Apple", "Samsung", "Sennheiser", "JBL", "Beats", "Anker", "Soundcore", "Audio-Technica",
  "Dell", "HP", "Lenovo", "Asus", "Acer", "Microsoft", "Framework", "Razer", "MSI",
  "Google", "OnePlus", "Motorola", "Xiaomi",
  "Nike", "Adidas", "New Balance", "Asics", "Hoka", "Brooks", "Puma", "Saucony", "Salomon",
];

const PREFERENCE_WORDS = [
  "wireless", "noise cancelling", "over-ear", "in-ear", "lightweight", "waterproof",
  "unlocked", "refurbished", "used", "black", "white", "blue", "red", "gaming", "running", "trail", "affordable", "cheap",
];

const SYMBOLS: Record<string, string> = { $: "USD", "£": "GBP", "€": "EUR" };
const WORDS: Record<string, string> = {
  dollars: "USD", dollar: "USD", usd: "USD", bucks: "USD",
  pounds: "GBP", pound: "GBP", gbp: "GBP", quid: "GBP",
  euros: "EUR", euro: "EUR", eur: "EUR",
};

const AMOUNT = String.raw`([$£€])?\s*(\d[\d,]*(?:\.\d{1,2})?)\s*(k\b)?\s*(dollars?|usd|bucks|pounds?|gbp|quid|euros?|eur)?`;
const LIMIT_WORDS = String.raw`under|below|less than|cheaper than|no more than|not more than|no higher than|at most|max(?:imum)?(?:\s+of)?|up to|budget(?:\s+of|\s+is)?(?:\s*:)?|within|spend(?:ing)?(?:\s+up\s+to)?|<=?`;
const LIMIT_RE = new RegExp(String.raw`(?:^|[\s,;(])(?:${LIMIT_WORDS})\s*(?:about\s+|around\s+)?${AMOUNT}`, "i");
const BARE_MONEY_RE = /(?:^|[\s,;(])(?:for\s+|at\s+)?([$£€])\s*(\d[\d,]*(?:\.\d{1,2})?)\s*(k\b)?()/i;

function amountToCents(num: string, k: string | undefined): number | null {
  const n = Number(num.replace(/,/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  const cents = Math.round(n * (k ? 1000 : 1) * 100);
  return Number.isSafeInteger(cents) ? cents : null;
}

const ARTICLE = String.raw`(?:\s+(?:this|the|a|an|some))?`;
const LEAD = new RegExp(
  String.raw`^\s*(?:please\s+)?(?:can you\s+|could you\s+)?(?:help\s+me\s+find${ARTICLE}|recommend${ARTICLE}|i(?:'|’)?d\s+like${ARTICLE}|track${ARTICLE}|watch(?:\s+for)?${ARTICLE}|find(?:\s+me)?${ARTICLE}|show(?:\s+me)?${ARTICLE}|i\s+(?:want|need)(?:\s+to\s+buy)?${ARTICLE}|i(?:'|’)?m\s+looking\s+for${ARTICLE}|looking\s+for${ARTICLE}|get\s+me${ARTICLE}|buy(?:\s+me)?${ARTICLE}|alert\s+me\s+(?:on|about|for)${ARTICLE})\b[:\s]*`,
  "i",
);

export function parseIntentFallback(input: string, defaultCurrency = "USD"): Intent {
  let text = input.trim().slice(0, 500);
  let maxPriceCents: number | undefined;
  let currency = defaultCurrency;

  const m = LIMIT_RE.exec(text) ?? BARE_MONEY_RE.exec(text);
  if (m) {
    const cents = amountToCents(m[2]!, m[3]);
    if (cents !== null) {
      maxPriceCents = cents;
      const sym = m[1] ? SYMBOLS[m[1]] : undefined;
      const word = m[4] ? WORDS[m[4].toLowerCase()] : undefined;
      currency = sym ?? word ?? defaultCurrency;
      text = (text.slice(0, m.index) + " " + text.slice(m.index + m[0].length)).trim();
    }
  }

  const lower = input.toLowerCase();
  const preferences = PREFERENCE_WORDS.filter((w) =>
    new RegExp(`(^|[^a-z-])${w.replace(/[-\s]/g, "[-\\s]")}([^a-z-]|$)`).test(lower),
  ).slice(0, 10);

  text = text.replace(LEAD, "");
  let brand: string | undefined;
  for (const b of [...KNOWN_BRANDS].sort((a, c) => c.length - a.length)) {
    const hit = new RegExp(`(^|[^\\w-])${b.replace(/-/g, "\\-")}(?=$|[^\\w-])`, "i").exec(text);
    if (hit) {
      brand = b;
      text = text.slice(0, hit.index) + hit[1] + text.slice(hit.index + hit[0].length);
      break;
    }
  }

  const product = text
    .replace(/\b(please|thanks|thank you|affordable|cheap|good|great|nice|really)\b/gi, " ")
    .replace(/[,;:.!?()]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+(?:for|at|and|that|which|but|with|costing|priced)\s*$/i, "")
    .replace(/^(?:a|an|the|some|this)\s+/i, "")
    .trim();

  const finalProduct = product || brand || "";
  const needsClarification = !finalProduct
    ? "What product are you looking for?"
    : maxPriceCents === undefined
      ? `What's the most you'd pay for ${brand ? `${brand} ` : ""}${product || "this"}?`
      : undefined;

  return {
    product: finalProduct.slice(0, 160) || "unspecified",
    ...(brand && product ? { brand } : {}),
    ...(maxPriceCents !== undefined ? { maxPriceCents } : {}),
    currency,
    preferences,
    ...(needsClarification ? { needsClarification } : {}),
  };
}
