/**
 * Live demo mode (DEMO_MODE=true): for the public preview of the item. Visitors sign in with the
 * demo accounts, try the CRM freely, and the worker resets the data every few hours. Anything
 * that reaches outside the server or changes the platform (payments, emails, WhatsApp
 * connections, AI keys, webhooks, admin settings, uploads) is refused.
 * Dependency-free: the API wrapper and pages call it on every request.
 */

export const isDemo = () => process.env.DEMO_MODE === "true";

/** Hours between data resets; the worker runs the reset on this schedule */
export const demoResetHours = () => Math.min(24, Math.max(1, Number(process.env.DEMO_RESET_HOURS) || 3));

export const DEMO_PASSWORD = "demo1234";

export const DEMO_ACCOUNTS = [
  { key: "admin", email: "admin@demo.test", name: "Demo Admin" },
  { key: "owner", email: "owner@demo.test", name: "Asha Sharma" },
  { key: "agent", email: "agent@demo.test", name: "Riya Kapoor" },
] as const;

export const DEMO_BLOCKED_MESSAGE = "This is turned off in the live demo.";

type Rule = [methods: string, path: RegExp];

const BLOCKED: Rule[] = [
  // Platform admin: look, don't touch (viewing a workspace as its owner is allowed)
  ["POST PUT PATCH DELETE", /^\/api\/admin\/(?!workspaces\/[^/]+\/impersonate$)/],
  // Emails to arbitrary addresses
  ["POST", /^\/api\/auth\/(register|forgot-password|reset-password|resend-verification)$/],
  ["POST", /^\/api\/team\/invitations$/],
  // The demo accounts must keep working
  ["PATCH DELETE", /^\/api\/team\/(members|invitations)\//],
  // Real WhatsApp numbers, messages to real phones, provider keys
  ["POST PATCH DELETE", /^\/api\/whatsapp\/accounts(\/|$)/],
  ["POST", /^\/api\/campaigns\/[^/]+\/test$/],
  ["PUT", /^\/api\/ai\/settings$/],
  ["POST", /^\/api\/ai\/test$/],
  // Requests to outside servers and API access
  ["POST PATCH DELETE", /^\/api\/developers(\/|$)/],
  // Payments
  ["POST PUT", /^\/api\/billing\/(checkout|confirm|details)$/],
  // File hosting
  ["POST", /^\/api\/campaigns\/media$/],
];

/** Why a request is refused in demo mode, or null when it's allowed */
export function demoBlocked(method: string, path: string, contentType: string | null): string | null {
  if (!isDemo() || ["GET", "HEAD", "OPTIONS"].includes(method)) return null;
  if (BLOCKED.some(([methods, re]) => methods.split(" ").includes(method) && re.test(path))) return DEMO_BLOCKED_MESSAGE;
  // Attachments (e.g. files sent in the inbox); CSV contact imports stay allowed
  if (contentType?.startsWith("multipart/form-data") && path !== "/api/contacts/imports") return DEMO_BLOCKED_MESSAGE;
  return null;
}
