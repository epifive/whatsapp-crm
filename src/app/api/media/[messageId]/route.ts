import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth/session";
import { readMedia } from "@/lib/storage";
import { orgDb } from "@/lib/tenancy";

// Shown inline in the chat; anything else downloads (so an uploaded HTML/SVG can never run as a page)
const INLINE = /^(image\/(jpeg|png|webp|gif)|video\/(mp4|3gpp)|audio\/(ogg|mpeg|mp4|aac|amr))$/;

/** Message attachment, only for members of the message's workspace */
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/media/[messageId]">) {
  const session = await getSession();
  if (!session?.org || !session.user.emailVerifiedAt) return new NextResponse("Unauthorized", { status: 401 });
  const { messageId } = await ctx.params;

  // Try every workspace of the user: a message link can be opened while another workspace is active
  for (const m of session.memberships) {
    const message = await orgDb(m.orgId).message.findUnique({ where: { id: messageId }, select: { media: true } });
    if (!message) continue;
    const media = (message.media ?? {}) as { storageKey?: string; mimeType?: string; fileName?: string };
    if (!media.storageKey) return new NextResponse("Not ready", { status: 404 });
    const data = await readMedia(media.storageKey);
    const mime = media.mimeType ?? "application/octet-stream";
    const inline = INLINE.test(mime);
    const name = (media.fileName ?? `file.${media.storageKey.split(".").pop()}`).replace(/["\r\n]/g, "");
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": inline ? mime : "application/octet-stream",
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${encodeURIComponent(name)}"; filename*=UTF-8''${encodeURIComponent(name)}`,
        "Content-Length": String(data.length),
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Cache-Control": "private, max-age=86400",
      },
    });
  }
  return new NextResponse("Not found", { status: 404 });
}
