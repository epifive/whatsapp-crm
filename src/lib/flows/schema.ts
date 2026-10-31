import { z } from "zod";
import type { Flow } from "@/generated/prisma/client";

// No .default()s: the schema is used with .partial() for updates, and zod applies defaults even
// to omitted keys there, which would reset settings that weren't sent
export const flowSettingsSchema = z.object({
  name: z.string().trim().min(1, "Give the flow a name.").max(100),
  description: z.string().trim().max(300).nullable().optional(),
  trigger: z.enum(["KEYWORD", "FIRST_MESSAGE", "ANY_MESSAGE", "CAMPAIGN_REPLY", "MANUAL"]),
  keywords: z.array(z.string().trim().min(1).max(60)).max(30),
  match: z.enum(["EXACT", "CONTAINS", "STARTS_WITH"]),
  accountIds: z.array(z.string().min(1)).max(50),
  campaignId: z.string().min(1).nullable().optional(),
  priority: z.coerce.number().int().min(-100).max(100),
  timeoutMinutes: z.coerce.number().int().min(1).max(10_080),
});

export type FlowSettings = z.infer<typeof flowSettingsSchema>;

export function flowView(f: Flow, extra: { activeSessions?: number } = {}) {
  return {
    id: f.id,
    name: f.name,
    description: f.description,
    isActive: f.isActive,
    trigger: f.trigger,
    keywords: f.keywords,
    match: f.match,
    accountIds: f.accountIds,
    campaignId: f.campaignId,
    priority: f.priority,
    timeoutMinutes: f.timeoutMinutes,
    runs: f.runs,
    completions: f.completions,
    activeSessions: extra.activeSessions ?? 0,
    updatedAt: f.updatedAt,
  };
}
