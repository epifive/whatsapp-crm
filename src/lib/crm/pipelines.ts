import { z } from "zod";
import type { DealStatus, Prisma, StageKind } from "@/generated/prisma/client";
import { contactDisplayName } from "@/lib/inbox";
import type { OrgDb } from "@/lib/tenancy";

export const DEFAULT_STAGES: { name: string; color: string; kind: StageKind; probability: number }[] = [
  { name: "New lead", color: "#64748b", kind: "OPEN", probability: 10 },
  { name: "Qualified", color: "#2563eb", kind: "OPEN", probability: 25 },
  { name: "Proposal sent", color: "#9333ea", kind: "OPEN", probability: 50 },
  { name: "Negotiation", color: "#ea580c", kind: "OPEN", probability: 75 },
  { name: "Won", color: "#16a34a", kind: "WON", probability: 100 },
  { name: "Lost", color: "#dc2626", kind: "LOST", probability: 0 },
];

/** Pipelines with their stages, in display order */
export async function listPipelines(tdb: OrgDb) {
  const pipelines = await tdb.pipeline.findMany({
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    include: { stages: { orderBy: { position: "asc" } }, _count: { select: { deals: true } } },
  });
  return pipelines.map((p) => ({
    id: p.id,
    name: p.name,
    deals: p._count.deals,
    stages: p.stages.map(({ id, name, color, kind, probability }) => ({ id, name, color, kind, probability })),
  }));
}

/** Every workspace gets a ready-to-use sales pipeline the first time it opens Deals */
export async function ensureDefaultPipeline(tdb: OrgDb, orgId: string) {
  if (await tdb.pipeline.count()) return;
  try {
    await tdb.pipeline.create({
      data: {
        orgId,
        name: "Sales pipeline",
        stages: { create: DEFAULT_STAGES.map((s, position) => ({ ...s, orgId, position })) },
      },
    });
  } catch (err) {
    // Two requests raced to create it; the other one won
    if ((err as { code?: string }).code !== "P2002") throw err;
  }
}

export const stageSchema = z.object({
  id: z.string().optional(), // existing stage; omitted for new ones
  name: z.string().trim().min(1, "Every stage needs a name.").max(40),
  color: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .default("#64748b"),
  kind: z.enum(["OPEN", "WON", "LOST"]).default("OPEN"),
  probability: z.coerce.number().int().min(0).max(100).default(0),
});

export const pipelineSchema = z.object({
  name: z.string().trim().min(1, "Enter a name.").max(60),
  stages: z
    .array(stageSchema)
    .min(1, "Add at least one stage.")
    .max(20, "A pipeline can have up to 20 stages.")
    .refine((s) => s.some((x) => x.kind === "OPEN"), "Keep at least one open stage."),
});

export function statusForStage(kind: StageKind): DealStatus {
  return kind === "WON" ? "WON" : kind === "LOST" ? "LOST" : "OPEN";
}

const GAP = 1024;

/** Position between two neighbours in a column (fractional ordering: no renumbering on moves) */
export function positionBetween(before: number | null | undefined, after: number | null | undefined): number {
  if (before == null && after == null) return GAP;
  if (before == null) return after! - GAP;
  if (after == null) return before + GAP;
  return (before + after) / 2;
}

export const dealInclude = {
  contact: { select: { id: true, phone: true, name: true, waName: true } },
  owner: { select: { id: true, name: true } },
  stage: { select: { id: true, name: true, color: true, kind: true } },
  _count: { select: { tasks: { where: { completedAt: null } } } },
} satisfies Prisma.DealInclude;

type DealRow = Prisma.DealGetPayload<{ include: typeof dealInclude }>;

export function dealView(d: DealRow) {
  return {
    id: d.id,
    title: d.title,
    value: d.value.toNumber(),
    currency: d.currency,
    status: d.status,
    pipelineId: d.pipelineId,
    stageId: d.stageId,
    stage: d.stage,
    position: d.position,
    expectedCloseAt: d.expectedCloseAt,
    closedAt: d.closedAt,
    lostReason: d.lostReason,
    contact: d.contact ? { id: d.contact.id, phone: d.contact.phone, name: contactDisplayName(d.contact) } : null,
    owner: d.owner,
    openTasks: d._count.tasks,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}

export type DealView = ReturnType<typeof dealView>;

export const dealBodySchema = z.object({
  title: z.string().trim().min(1, "Enter a title.").max(120),
  // No default: with .partial() for edits it would reset the value (the database default is 0)
  value: z.coerce.number().min(0, "Value can't be negative.").max(999_999_999_999).optional(),
  pipelineId: z.string().min(1),
  stageId: z.string().min(1),
  contactId: z.string().min(1).nullable().optional(),
  ownerId: z.string().min(1).nullable().optional(),
  expectedCloseAt: z.coerce.date().nullable().optional(),
  lostReason: z.string().trim().max(200).nullable().optional(),
});

export const CURRENCIES = ["USD", "EUR", "GBP", "INR", "AED", "SAR", "BRL", "MXN", "IDR", "NGN", "PKR", "BDT", "ZAR", "AUD", "CAD", "SGD", "MYR", "TRY", "EGP", "KES"] as const;
