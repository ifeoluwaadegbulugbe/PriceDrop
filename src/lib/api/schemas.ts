import { z } from "zod";

// Strict everywhere: an unexpected field such as a tampered "amount" is rejected, not ignored.
const cents = z.number().int().positive().max(100_000_000);
const domains = z.array(z.string().min(1).max(253)).max(30);
const variants = z.array(z.string().min(1).max(120)).max(30).nullable();

export const intentBody = z.strictObject({ prompt: z.string().trim().min(1).max(500) });

export const searchQuery = z.strictObject({
  q: z.string().trim().min(1).max(200),
  brand: z.string().trim().min(1).max(60).optional(),
  min: z.coerce.number().int().min(0).max(100_000_000).optional(),
  max: z.coerce.number().int().min(0).max(100_000_000).optional(),
});

export const createTrackingBody = z
  .strictObject({
    source: z.enum(["channel3", "seed"]),
    externalId: z.string().min(1).max(200),
    targetPriceCents: cents,
    maxTotalCents: cents,
    allowedDomains: domains.default([]),
    allowedVariants: variants.default(null),
    requireInStock: z.boolean().default(true),
  })
  .refine((v) => v.targetPriceCents <= v.maxTotalCents, { message: "target above max" });

export const updateTrackingBody = z.strictObject({
  targetPriceCents: cents.optional(),
  maxTotalCents: cents.optional(),
  allowedDomains: domains.optional(),
  allowedVariants: variants.optional(),
  requireInStock: z.boolean().optional(),
  status: z.enum(["active", "paused"]).optional(),
});

export const idParam = z.uuid();
export const prepareBody = z.strictObject({ alertId: z.uuid() });
export const orderBody = z.strictObject({ orderId: z.uuid() });
export const simulateBody = z.strictObject({ trackedProductId: z.uuid(), priceCents: cents });
