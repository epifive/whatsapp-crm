import { db } from "./db";

/**
 * Models that belong to one organization. Every new tenant model must be added here so the
 * scoped client below keeps cross-organization data out of reach.
 */
export const ORG_SCOPED_MODELS = new Set<string>([
  "Membership",
  "Invitation",
  "AuditLog",
  "WhatsAppAccount",
  "Contact",
  "Tag",
  "Conversation",
  "Message",
  "CannedResponse",
  "Template",
  "Note",
  "CustomField",
  "Segment",
  "ContactImport",
  "Pipeline",
  "Stage",
  "Deal",
  "Task",
  "Activity",
  "Campaign",
  "CampaignRecipient",
  "Flow",
  "FlowSession",
  "ApiKey",
  "WebhookEndpoint",
  "WebhookDelivery",
  "AiConfig",
  "KnowledgeArticle",
  "AiUsage",
  "Subscription",
  "Invoice",
  "Payment",
]);

const WHERE_OPERATIONS = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "delete",
  "deleteMany",
  "upsert",
]);

/**
 * Prisma client limited to one organization: `orgId` is added to every filter and to every
 * created row of org-scoped models, so a forgotten `where: { orgId }` can't read or modify
 * another tenant's data.
 */
export function orgDb(orgId: string) {
  if (!orgId) throw new Error("orgDb requires an orgId");
  return db.$extends({
    name: "org-scope",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!model || !ORG_SCOPED_MODELS.has(model)) return query(args);
          // Prisma passes untyped args to $allOperations; we only touch where/data/create
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const a = (args ?? {}) as Record<string, any>;

          // An explicit filter for another organization is a bug in the caller: fail loudly
          // instead of silently answering with this organization's rows
          if (a.where?.orgId !== undefined && a.where.orgId !== orgId) {
            throw new Error(`Cross-organization query blocked on ${model}.${operation}`);
          }

          if (WHERE_OPERATIONS.has(operation)) {
            a.where = { ...(a.where ?? {}), orgId };
          }
          if (operation === "create") {
            a.data = { ...(a.data ?? {}), orgId };
          }
          if (operation === "createMany" || operation === "createManyAndReturn") {
            a.data = (Array.isArray(a.data) ? a.data : [a.data]).map((row: object) => ({ ...row, orgId }));
          }
          if (operation === "upsert") {
            a.create = { ...(a.create ?? {}), orgId };
          }
          return query(a);
        },
      },
    },
  });
}

export type OrgDb = ReturnType<typeof orgDb>;
