import fs from "node:fs/promises";
import path from "node:path";
import nodemailer from "nodemailer";
import { getBranding, getSetting } from "./settings";
import { STORAGE_ROOT } from "./paths";

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

const OUTBOX_DIR = path.join(STORAGE_ROOT, "mail-outbox");

/**
 * Sends through the SMTP server configured in Admin > Settings. Without SMTP (fresh install,
 * development) the message is written to storage/mail-outbox so nothing is silently lost.
 */
export async function sendMail(message: MailMessage): Promise<{ delivered: boolean }> {
  const smtp = await getSetting("smtp");
  if (!smtp?.host) {
    await fs.mkdir(OUTBOX_DIR, { recursive: true });
    const file = path.join(OUTBOX_DIR, `${Date.now()}-${message.to.replace(/[^a-z0-9@._-]/gi, "_")}.json`);
    await fs.writeFile(file, JSON.stringify(message, null, 2));
    console.warn(`[mail] SMTP not configured — saved "${message.subject}" for ${message.to} to ${file}`);
    return { delivered: false };
  }

  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: smtp.user ? { user: smtp.user, pass: smtp.password } : undefined,
  });
  await transport.sendMail({
    from: { name: smtp.fromName, address: smtp.fromEmail },
    to: message.to,
    subject: message.subject,
    html: message.html,
    text: message.text,
  });
  return { delivered: true };
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Simple branded email with one call-to-action button */
export async function actionEmail(opts: {
  to: string;
  subject: string;
  heading: string;
  intro: string;
  buttonLabel: string;
  url: string;
  footer?: string;
}): Promise<{ delivered: boolean }> {
  const brand = await getBranding();
  const footer = opts.footer ?? "If you didn't request this, you can ignore this email.";
  const html = `<!doctype html><html><body style="margin:0;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
    <table width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;padding:32px">
      <tr><td style="font-size:18px;font-weight:bold;color:#111827">${escapeHtml(brand.appName)}</td></tr>
      <tr><td style="padding-top:24px;font-size:20px;font-weight:bold;color:#111827">${escapeHtml(opts.heading)}</td></tr>
      <tr><td style="padding-top:12px;font-size:15px;line-height:22px;color:#374151">${escapeHtml(opts.intro)}</td></tr>
      <tr><td style="padding-top:24px"><a href="${escapeHtml(opts.url)}" style="display:inline-block;background:${escapeHtml(brand.primaryColor)};color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:8px">${escapeHtml(opts.buttonLabel)}</a></td></tr>
      <tr><td style="padding-top:24px;font-size:12px;color:#6b7280;word-break:break-all">Or open this link: ${escapeHtml(opts.url)}</td></tr>
      <tr><td style="padding-top:16px;font-size:12px;color:#6b7280">${escapeHtml(footer)}</td></tr>
    </table>
  </td></tr></table></body></html>`;
  const text = `${opts.heading}\n\n${opts.intro}\n\n${opts.buttonLabel}: ${opts.url}\n\n${footer}`;
  return sendMail({ to: opts.to, subject: opts.subject, html, text });
}
