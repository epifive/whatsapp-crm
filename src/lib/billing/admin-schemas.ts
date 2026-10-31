import { z } from "zod";
import { toMinor } from "./money";
import { featuresSchema, limitsSchema } from "./plans";

/** Price typed in the admin form ("499" or "499.50") → smallest currency unit */
export const priceField = (currency: string) =>
  z.union([z.string(), z.number()]).transform((v, ctx) => {
    const minor = toMinor(v === "" ? "0" : v, currency);
    if (minor === null || minor > 1_000_000_000) {
      ctx.addIssue({ code: "custom", message: `Enter a price like 499 or 499.50 (${currency}).` });
      return z.NEVER;
    }
    return minor;
  });

export const planBody = (currency: string) =>
  z.object({
    name: z.string().trim().min(1, "Name the plan.").max(60),
    description: z.string().trim().max(300).default(""),
    priceMonthly: priceField(currency),
    priceYearly: priceField(currency),
    trialDays: z.coerce.number().int().min(0).max(365),
    limits: limitsSchema,
    features: featuresSchema,
    isPublic: z.boolean(),
    isActive: z.boolean(),
    sortOrder: z.coerce.number().int().min(0).max(1000).default(0),
  });

export const couponBody = (currency: string) =>
  z
    .object({
      code: z
        .string()
        .trim()
        .toUpperCase()
        .regex(/^[A-Z0-9_-]{3,30}$/, "Use 3-30 letters, numbers, - or _ for the code."),
      type: z.enum(["percent", "amount"]),
      percentOff: z.coerce.number().int().min(1, "Between 1 and 100%.").max(100, "Between 1 and 100%.").optional(),
      amountOff: priceField(currency).optional(),
      planIds: z.array(z.string()).max(100).default([]),
      maxRedemptions: z.coerce.number().int().min(1).max(1_000_000).nullable().default(null),
      expiresAt: z.coerce.date().nullable().default(null),
      isActive: z.boolean().default(true),
    })
    .superRefine((v, ctx) => {
      if (v.type === "percent" && !v.percentOff) ctx.addIssue({ code: "custom", path: ["percentOff"], message: "Enter the discount percentage." });
      if (v.type === "amount" && !v.amountOff) ctx.addIssue({ code: "custom", path: ["amountOff"], message: "Enter the discount amount." });
    });
