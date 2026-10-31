import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { effectiveDailyLimit, isOptOutMessage, PacingQueue, renderVariables, sentTodayFor, spin, dayKey } from "@/lib/whatsapp/anti-ban";
import { normalizePhone, isValidPhone } from "@/lib/whatsapp/phone";
import { isWindowOpen } from "@/lib/whatsapp/window";
import { parseWebhook, verifyWebhookSignature } from "@/lib/whatsapp/official/webhook";
import { buildTemplatePayload, renderTemplatePreview, templateVariables } from "@/lib/whatsapp/templates";

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

describe("anti-ban engine", () => {
  it("spintax picks options and leaves placeholders alone", () => {
    expect(["Hi", "Hello"]).toContain(spin("{Hi|Hello}"));
    expect(spin("Code {{otp}} {word}")).toBe("Code {{otp}} {word}");
    expect(["a", "b", "c"]).toContain(spin("{a|{b|c}}"));
  });

  it("renders variables literally and escapes keys", () => {
    expect(renderVariables("Hi {{ name }}, pay {{amt}}", { name: "Ravi", amt: "$& 99" })).toBe("Hi Ravi, pay $& 99");
    expect(renderVariables("{{a(b}}", { "a(b": "x" })).toBe("x");
  });

  it("detects opt-outs without false positives", () => {
    for (const t of ["STOP", "Stop.", "stop please", "unsubscribe 🙏", "mat bhejo", "नहीं चाहिए"]) expect(isOptOutMessage(t), t).toBe(true);
    for (const t of ["cancel my order", "stopwatch", "hello", ""]) expect(isOptOutMessage(t), t).toBe(false);
  });

  it("applies the warmup schedule until day 7", () => {
    const limit = (days: number) => effectiveDailyLimit({ dailyLimit: 300, warmupEnabled: true, connectedAt: daysAgo(days) });
    expect([0, 1, 2, 3, 4, 5, 6, 30].map(limit)).toEqual([25, 50, 125, 125, 250, 250, 300, 300]);
    expect(effectiveDailyLimit({ dailyLimit: 300, warmupEnabled: false, connectedAt: new Date() })).toBe(300);
    expect(effectiveDailyLimit({ dailyLimit: 20, warmupEnabled: true, connectedAt: new Date() })).toBe(20);
    expect(effectiveDailyLimit({ dailyLimit: 300, warmupEnabled: true, connectedAt: null })).toBe(25);
  });

  it("only counts today's sends", () => {
    expect(sentTodayFor({ sentToday: 40, sentTodayDate: dayKey() })).toBe(40);
    expect(sentTodayFor({ sentToday: 40, sentTodayDate: "2000-01-01" })).toBe(0);
  });

  it("pacing runs one send at a time with the gap between starts", async () => {
    const q = new PacingQueue();
    const starts: number[] = [];
    let running = 0;
    let maxRunning = 0;
    const t0 = Date.now();
    await Promise.all(
      [0, 1, 2].map(() =>
        q.run("n1", 150, async () => {
          running++;
          maxRunning = Math.max(maxRunning, running);
          starts.push(Date.now() - t0);
          await new Promise((r) => setTimeout(r, 20));
          running--;
        }),
      ),
    );
    expect(maxRunning).toBe(1);
    expect(starts[1]).toBeGreaterThanOrEqual(145);
    expect(starts[2]).toBeGreaterThanOrEqual(295);
    // Another number isn't blocked
    const other = Date.now();
    await q.run("n2", 1000, async () => null);
    expect(Date.now() - other).toBeLessThan(100);
  });
});

describe("phone numbers", () => {
  it("normalizes with and without country code", () => {
    expect(normalizePhone("+91 90000 12345")).toBe("919000012345");
    expect(normalizePhone("0091 90000 12345")).toBe("919000012345");
    expect(normalizePhone("090000 12345", "91")).toBe("919000012345");
    expect(normalizePhone("9000012345", "91")).toBe("919000012345");
    expect(normalizePhone("+1 (415) 555-0100")).toBe("14155550100");
    expect(isValidPhone("919000012345")).toBe(true);
    expect(isValidPhone("123")).toBe(false);
  });
});

describe("24-hour window", () => {
  it("is open only within 24h of the last customer message", () => {
    expect(isWindowOpen(null)).toBe(false);
    expect(isWindowOpen(new Date(Date.now() - 23 * 3600_000))).toBe(true);
    expect(isWindowOpen(new Date(Date.now() - 25 * 3600_000))).toBe(false);
  });
});

describe("Cloud API webhooks", () => {
  const body = JSON.stringify({ object: "whatsapp_business_account", entry: [] });
  const sign = (secret: string, raw: string) => "sha256=" + crypto.createHmac("sha256", secret).update(raw).digest("hex");

  it("verifies the signature with the app secret", () => {
    expect(verifyWebhookSignature(body, sign("secret-1", body), "secret-1")).toBe(true);
    expect(verifyWebhookSignature(body, sign("other", body), "secret-1")).toBe(false);
    expect(verifyWebhookSignature(body + " ", sign("secret-1", body), "secret-1")).toBe(false);
    expect(verifyWebhookSignature(body, null, "secret-1")).toBe(false);
  });

  it("parses messages, media, replies and statuses", () => {
    const events = parseWebhook({
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: {
                metadata: { phone_number_id: "111" },
                contacts: [{ wa_id: "919800000001", profile: { name: "Ravi" } }],
                messages: [
                  { id: "wamid.1", from: "919800000001", timestamp: "1700000000", type: "text", text: { body: "hello" } },
                  { id: "wamid.2", from: "919800000001", timestamp: "1700000001", type: "image", image: { id: "m-9", mime_type: "image/jpeg", caption: "pic" }, context: { id: "wamid.0" } },
                  { id: "wamid.3", from: "919800000001", timestamp: "1700000002", type: "interactive", interactive: { type: "button_reply", button_reply: { id: "yes", title: "Yes" } } },
                ],
                statuses: [
                  { id: "wamid.out", status: "delivered", timestamp: "1700000003" },
                  { id: "wamid.bad", status: "failed", timestamp: "1700000004", errors: [{ code: 131026, title: "Message undeliverable" }] },
                ],
              },
            },
          ],
        },
      ],
    });
    expect(events.map((e) => e.kind)).toEqual(["message", "message", "message", "status", "status"]);
    expect(events[0]).toMatchObject({ type: "TEXT", body: "hello", from: "919800000001", profileName: "Ravi", phoneNumberId: "111" });
    expect(events[1]).toMatchObject({ type: "IMAGE", body: "pic", replyToExternalId: "wamid.0", media: { providerMediaId: "m-9" } });
    expect(events[2]).toMatchObject({ type: "INTERACTIVE", body: "Yes", payload: { replyId: "yes" } });
    expect(events[4]).toMatchObject({ status: "FAILED", error: "Message undeliverable (131026)" });
  });

  it("ignores malformed payloads", () => {
    expect(parseWebhook(null)).toEqual([]);
    expect(parseWebhook({ entry: [{ changes: [{ field: "messages", value: {} }] }] })).toEqual([]);
  });
});

describe("templates", () => {
  const components = [
    { type: "HEADER", format: "TEXT", text: "Order {{1}}" },
    { type: "BODY", text: "Hi {{1}}, your total is {{2}}." },
    { type: "FOOTER", text: "Thanks" },
  ];
  it("counts variables and renders a preview", () => {
    expect(templateVariables(components)).toEqual({ header: 1, body: 2, mediaHeader: false });
    expect(renderTemplatePreview(components, ["#12"], ["Ravi", "₹500"])).toBe("*Order #12*\n\nHi Ravi, your total is ₹500.\n\n_Thanks_");
    expect(buildTemplatePayload("order_update", "en_US", { header: ["#12"], body: ["Ravi", "₹500"] }, components)).toEqual({
      name: "order_update",
      language: { code: "en_US" },
      components: [
        { type: "header", parameters: [{ type: "text", text: "#12" }] },
        { type: "body", parameters: [{ type: "text", text: "Ravi" }, { type: "text", text: "₹500" }] },
      ],
    });
  });
});
