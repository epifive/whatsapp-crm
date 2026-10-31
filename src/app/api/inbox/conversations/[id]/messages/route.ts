import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, requireApiOrg, route } from "@/lib/api";
import { messageView } from "@/lib/inbox";
import { rateLimit } from "@/lib/rate-limit";
import { MAX_UPLOAD_BYTES, messageTypeForMime, saveMedia } from "@/lib/storage";
import { orgDb } from "@/lib/tenancy";
import { pauseForAgent } from "@/lib/flows/engine";
import { queueOutbound } from "@/lib/whatsapp/outbound";
import { buildTemplatePayload, renderTemplatePreview, templateSpec, templateVariables } from "@/lib/whatsapp/templates";
import { isWindowOpen } from "@/lib/whatsapp/window";

type Ctx = RouteContext<"/api/inbox/conversations/[id]/messages">;

const PAGE_SIZE = 40;

/** GET ?before=<messageId> : newest messages first page, then older pages */
export const GET = route<Ctx>(async (req, ctx) => {
  const session = await requireApiOrg("AGENT");
  const { id } = await ctx.params;
  const tdb = orgDb(session.org.id);
  if (!(await tdb.conversation.findUnique({ where: { id }, select: { id: true } }))) throw new ApiError(404, "Conversation not found.");

  const before = req.nextUrl.searchParams.get("before");
  const rows = await tdb.message.findMany({
    where: { conversationId: id },
    include: { sentBy: { select: { name: true } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: PAGE_SIZE + 1,
    ...(before ? { cursor: { id: before }, skip: 1 } : {}),
  });
  const hasMore = rows.length > PAGE_SIZE;
  const page = rows.slice(0, PAGE_SIZE).reverse();
  return NextResponse.json({ messages: page.map(messageView), hasMore });
});

const textBody = z.object({
  type: z.literal("text"),
  body: z.string().trim().min(1, "Type a message.").max(4096, "Messages can be at most 4096 characters."),
  replyToId: z.string().optional(),
});
const templateBody = z.object({
  type: z.literal("template"),
  templateId: z.string().min(1),
  headerParams: z.array(z.string().max(60)).max(1).default([]),
  bodyParams: z.array(z.string().trim().min(1, "Fill in every template variable.").max(1024)).max(20).default([]),
});

const ALLOWED_UPLOAD = /^(image\/(jpeg|png|webp)|video\/(mp4|3gpp)|audio\/(ogg|mpeg|mp4|aac|amr)|application\/pdf|text\/plain|application\/(msword|vnd\.openxmlformats-officedocument\.[a-z.]+|vnd\.ms-excel|vnd\.ms-powerpoint))$/;

/** Send a reply: JSON text/template, or multipart with a file (+ optional caption) */
export const POST = route<Ctx>(async (req, ctx) => {
  const session = await requireApiOrg("AGENT");
  const { id } = await ctx.params;
  const tdb = orgDb(session.org.id);
  const conversation = await tdb.conversation.findUnique({ where: { id }, include: { account: true } });
  if (!conversation) throw new ApiError(404, "Conversation not found.");
  if (!rateLimit(`send:${session.user.id}`, 60, 60_000).ok) throw new ApiError(429, "You're sending too fast. Slow down a little.");

  const { account } = conversation;
  const official = account.channel === "OFFICIAL";
  const base = { orgId: session.org.id, conversationId: id, accountId: account.id, sentById: session.user.id };
  // A teammate writing in the chat takes over from the chatbot
  await pauseForAgent(id);

  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    if (official && !isWindowOpen(conversation.lastInboundAt)) throw new ApiError(400, "The 24-hour reply window is closed. Send an approved template instead.", "window_closed");
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) throw new ApiError(400, "Choose a file to send.");
    if (file.size > MAX_UPLOAD_BYTES) throw new ApiError(400, `Files can be at most ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB.`);
    const mimeType = file.type || "application/octet-stream";
    if (!ALLOWED_UPLOAD.test(mimeType)) throw new ApiError(400, "This file type can't be sent on WhatsApp.");
    const caption = String(form.get("caption") ?? "").trim().slice(0, 1024);
    const fileName = file.name.replace(/[\\/:*?"<>|]+/g, "_").slice(-120) || "file";
    const saved = await saveMedia(session.org.id, Buffer.from(await file.arrayBuffer()), mimeType, fileName);
    const message = await queueOutbound({
      ...base,
      type: messageTypeForMime(mimeType),
      body: caption || null,
      media: { ...saved, mimeType, fileName },
      replyToId: (form.get("replyToId") as string | null) || null,
    });
    return NextResponse.json({ message: messageView(message) }, { status: 201 });
  }

  const json = await req.json().catch(() => {
    throw new ApiError(400, "Invalid request.");
  });

  if (json?.type === "template") {
    const input = templateBody.parse(json);
    if (!official) throw new ApiError(400, "Templates are for Cloud API numbers.");
    const template = await tdb.template.findUnique({ where: { id: input.templateId } });
    if (!template || template.accountId !== account.id) throw new ApiError(404, "Template not found for this number.");
    if (template.status !== "APPROVED") throw new ApiError(400, "Only approved templates can be sent.");
    const vars = templateVariables(template.components);
    if (vars.mediaHeader || templateSpec(template.components).buttons.length) {
      throw new ApiError(400, "Templates with a media header or a dynamic button can be sent from Campaigns.");
    }
    if (input.headerParams.length !== vars.header || input.bodyParams.length !== vars.body) throw new ApiError(400, "Fill in every template variable.");

    const message = await queueOutbound({
      ...base,
      type: "TEMPLATE",
      body: renderTemplatePreview(template.components, input.headerParams, input.bodyParams),
      payload: {
        templateId: template.id,
        template: buildTemplatePayload(template.name, template.language, { header: input.headerParams, body: input.bodyParams }, template.components),
      },
    });
    return NextResponse.json({ message: messageView(message) }, { status: 201 });
  }

  const input = textBody.parse(json);
  if (official && !isWindowOpen(conversation.lastInboundAt)) throw new ApiError(400, "The 24-hour reply window is closed. Send an approved template instead.", "window_closed");
  if (input.replyToId && !(await tdb.message.findFirst({ where: { id: input.replyToId, conversationId: id }, select: { id: true } }))) {
    throw new ApiError(400, "The message you're replying to wasn't found.");
  }
  const message = await queueOutbound({ ...base, type: "TEXT", body: input.body, replyToId: input.replyToId ?? null });
  return NextResponse.json({ message: messageView(message) }, { status: 201 });
});
