import { NextResponse } from "next/server";
import { ApiError, requireApiSuperAdmin, route } from "@/lib/api";
import { getSetting } from "@/lib/settings";
import { sendMail } from "@/lib/mail";

// Sends a test email to the signed-in admin using the saved SMTP settings
export const POST = route(async () => {
  const session = await requireApiSuperAdmin();
  if (!(await getSetting("smtp"))?.host) throw new ApiError(400, "Save your SMTP settings first.");
  try {
    await sendMail({
      to: session.user.email,
      subject: "SMTP test",
      text: "Your SMTP settings work. Emails such as verifications and invitations will be delivered.",
      html: "<p>Your SMTP settings work. Emails such as verifications and invitations will be delivered.</p>",
    });
  } catch (err) {
    throw new ApiError(400, `SMTP error: ${(err as Error).message}`);
  }
  return NextResponse.json({ ok: true, to: session.user.email });
});
