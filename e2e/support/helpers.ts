import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "@playwright/test";
import { APP_URL, META_URL } from "./env";
import type { SentMessage } from "./mock-meta";

const outbox = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "storage", "mail-outbox");

/** The newest email the app saved for this address (no SMTP in tests), polled until it shows up */
export async function lastEmailTo(email: string): Promise<{ subject: string; text: string; html: string }> {
  const suffix = `-${email.replace(/[^a-z0-9@._-]/gi, "_")}.json`;
  let file: string | undefined;
  await expect
    .poll(() => {
      file = fs.existsSync(outbox) ? fs.readdirSync(outbox).filter((f) => f.endsWith(suffix)).sort().pop() : undefined;
      return file;
    }, { message: `email to ${email}` })
    .toBeTruthy();
  return JSON.parse(fs.readFileSync(path.join(outbox, file!), "utf8"));
}

export function firstLink(text: string): string {
  const url = text.match(/https?:\/\/\S+/)?.[0];
  if (!url) throw new Error(`No link in:\n${text}`);
  return url;
}

export async function sentMessages(): Promise<SentMessage[]> {
  const res = await fetch(`${META_URL}/__e2e/messages`);
  return ((await res.json()) as { messages: SentMessage[] }).messages;
}

/** Waits until the app has sent a message through the fake Cloud API that matches */
export async function expectSent(match: (m: SentMessage) => boolean, what: string): Promise<SentMessage> {
  let found: SentMessage | undefined;
  await expect.poll(async () => (found = (await sentMessages()).find(match)), { message: what, timeout: 30_000 }).toBeTruthy();
  return found!;
}

/** Delivers a customer's text message to the app the way Meta does: a webhook signed with the app secret */
export async function receiveText(opts: { accountId: string; phoneNumberId: string; appSecret: string; from: string; name: string; text: string }) {
  const payload = {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "1000000001",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "15550100100", phone_number_id: opts.phoneNumberId },
              contacts: [{ profile: { name: opts.name }, wa_id: opts.from }],
              messages: [
                {
                  from: opts.from,
                  id: `wamid.IN${Date.now()}${Math.random().toString(36).slice(2, 8)}`,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: "text",
                  text: { body: opts.text },
                },
              ],
            },
          },
        ],
      },
    ],
  };
  const raw = JSON.stringify(payload);
  const signature = crypto.createHmac("sha256", opts.appSecret).update(raw).digest("hex");
  const res = await fetch(`${APP_URL}/api/webhooks/whatsapp/${opts.accountId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Hub-Signature-256": `sha256=${signature}` },
    body: raw,
  });
  expect(res.status, "webhook accepted").toBe(200);
}
