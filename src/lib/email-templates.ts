import { actionEmail } from "@/lib/mail";
import { getBranding, getSetting } from "@/lib/settings";

/**
 * Every email the platform sends. The platform admin can change the texts in Admin › Settings;
 * {{placeholders}} are filled in when the email is sent ({{app_name}} works everywhere).
 */

export interface EmailTemplate {
  subject: string;
  heading: string;
  body: string;
  button: string;
}

export const EMAIL_TEMPLATES = {
  verify_email: {
    vars: ["name"],
    subject: "Verify your email address",
    heading: "Welcome, {{name}}!",
    body: "Please confirm your email address to start using your account. This link is valid for 24 hours.",
    button: "Verify email",
  },
  reset_password: {
    vars: ["name"],
    subject: "Reset your password",
    heading: "Reset your password",
    body: "Hi {{name}}, we received a request to reset your password. This link is valid for 1 hour and can be used once.",
    button: "Choose a new password",
  },
  invitation: {
    vars: ["inviter", "workspace", "role"],
    subject: "{{inviter}} invited you to {{workspace}}",
    heading: "Join {{workspace}}",
    body: "{{inviter}} invited you to join {{workspace}} as {{role}}. The invitation is valid for 7 days.",
    button: "Accept invitation",
  },
  task_due: {
    vars: ["task", "workspace"],
    subject: "Task due: {{task}}",
    heading: "A task is due",
    body: '"{{task}}" in {{workspace}} is due now.',
    button: "Open tasks",
  },
  payment_receipt: {
    vars: ["name", "workspace", "plan", "amount", "invoice", "period_end"],
    subject: "Payment received: {{invoice}}",
    heading: "Thank you for your payment",
    body: "We received {{amount}} for the {{plan}} plan of {{workspace}}. Your plan is active until {{period_end}}. Invoice {{invoice}} is in Settings › Billing.",
    button: "View invoice",
  },
  trial_ending: {
    vars: ["name", "workspace", "plan", "date"],
    subject: "Your free trial ends on {{date}}",
    heading: "Your trial ends soon",
    body: "The free trial of the {{plan}} plan for {{workspace}} ends on {{date}}. Choose a plan to keep using WhatsApp, campaigns and automations without interruption.",
    button: "Choose a plan",
  },
  renewal_reminder: {
    vars: ["name", "workspace", "plan", "date", "amount"],
    subject: "Your {{plan}} plan renews on {{date}}",
    heading: "Time to renew",
    body: "The {{plan}} plan of {{workspace}} is paid until {{date}}. Renew now ({{amount}}) to keep everything running.",
    button: "Renew now",
  },
  payment_due: {
    vars: ["name", "workspace", "plan", "date"],
    subject: "Payment due for {{workspace}}",
    heading: "Your plan has ended",
    body: "The {{plan}} plan of {{workspace}} has ended. Renew by {{date}} to avoid interruption: after that the workspace becomes read-only until it is renewed.",
    button: "Renew now",
  },
  subscription_expired: {
    vars: ["name", "workspace", "plan"],
    subject: "{{workspace}} is now read-only",
    heading: "Your subscription has ended",
    body: "The subscription of {{workspace}} has ended, so it is read-only: your data is safe, but messages, campaigns and automations are paused. Renew to continue right away.",
    button: "Renew now",
  },
  offline_payment_review: {
    vars: ["workspace", "amount", "invoice", "reference"],
    subject: "Offline payment to confirm: {{invoice}}",
    heading: "An offline payment needs your review",
    body: "{{workspace}} reports paying {{amount}} for invoice {{invoice}} (reference: {{reference}}). Check your account and mark the invoice as paid.",
    button: "Review payments",
  },
} as const satisfies Record<string, EmailTemplate & { vars: readonly string[] }>;

export type EmailTemplateKey = keyof typeof EMAIL_TEMPLATES;
export const EMAIL_TEMPLATE_KEYS = Object.keys(EMAIL_TEMPLATES) as EmailTemplateKey[];

export function fillPlaceholders(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (m, k: string) => (k in vars ? vars[k] : m));
}

/** The template with the admin's changes (empty fields fall back to the built-in text) */
export async function resolveTemplate(key: EmailTemplateKey): Promise<EmailTemplate> {
  const custom = (await getSetting("emailTemplates"))?.[key];
  const def = EMAIL_TEMPLATES[key];
  return {
    subject: custom?.subject?.trim() || def.subject,
    heading: custom?.heading?.trim() || def.heading,
    body: custom?.body?.trim() || def.body,
    button: custom?.button?.trim() || def.button,
  };
}

export async function sendTemplateEmail(key: EmailTemplateKey, opts: { to: string; url: string; vars: Record<string, string>; footer?: string }) {
  const [tpl, brand] = await Promise.all([resolveTemplate(key), getBranding()]);
  const vars = { app_name: brand.appName, ...opts.vars };
  return actionEmail({
    to: opts.to,
    subject: fillPlaceholders(tpl.subject, vars).slice(0, 200),
    heading: fillPlaceholders(tpl.heading, vars),
    intro: fillPlaceholders(tpl.body, vars),
    buttonLabel: fillPlaceholders(tpl.button, vars),
    url: opts.url,
    footer: opts.footer,
  });
}
