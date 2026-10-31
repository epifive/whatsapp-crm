import { NextResponse } from "next/server";
import { ApiError, requireApiOrg, route } from "@/lib/api";
import { CAMPAIGN_MEDIA_TYPES } from "@/lib/campaigns/schema";
import { MAX_UPLOAD_BYTES, saveMedia } from "@/lib/storage";

/** Upload the image / video / PDF a campaign sends; returns the reference to store on the campaign */
export const POST = route(async (req) => {
  const session = await requireApiOrg("ADMIN");
  const form = await req.formData().catch(() => {
    throw new ApiError(400, "Upload a file.");
  });
  const file = form.get("file");
  if (!(file instanceof File) || !file.size) throw new ApiError(400, "Upload a file.");
  if (!CAMPAIGN_MEDIA_TYPES[file.type]) throw new ApiError(400, "Use a JPG or PNG image, an MP4 video or a PDF.");
  // WhatsApp's own limits: images 5 MB, video and documents 16 MB
  const limit = CAMPAIGN_MEDIA_TYPES[file.type] === "IMAGE" ? 5 * 1024 * 1024 : MAX_UPLOAD_BYTES;
  if (file.size > limit) throw new ApiError(400, `The file is larger than ${limit / 1024 / 1024} MB.`);
  const fileName = file.name.replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "file";
  const saved = await saveMedia(session.org.id, Buffer.from(await file.arrayBuffer()), file.type, fileName);
  return NextResponse.json({ media: { storageKey: saved.storageKey, mimeType: file.type, fileName, size: saved.size } }, { status: 201 });
});
