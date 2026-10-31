import { expect, test, type Page } from "@playwright/test";
import { APP_URL } from "./support/env";
import { expectSent, firstLink, lastEmailTo, receiveText } from "./support/helpers";
import { APPROVED_TEMPLATE } from "./support/mock-meta";

/**
 * The main journey of a new customer of the platform, in the browser:
 * register → verify email → create workspace → connect a Cloud API number → reply in the inbox
 * → sync templates → send a campaign → a chatbot flow answers a keyword.
 * WhatsApp traffic goes through the fake Meta Graph API started by global-setup.
 */
test.describe.configure({ mode: "serial" });

const run = Date.now().toString(36);
const owner = { name: "Asha Owner", email: `owner-${run}@e2e.test`, password: "Owner-pass-1234" };
const number = { phoneNumberId: "1090000123451", wabaId: "2090000123452", accessToken: "EAAE2E-test-token-0123456789", appSecret: "e2e-app-secret-0123456789" };
const customer = { phone: "919812300001", name: "Ravi Mehra" };
const lead = { phone: "919812300002", name: "Meera" };

let page: Page;
let accountId: string;

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  // Launch / delete confirmations are native confirm() dialogs
  page.on("dialog", (dialog) => void dialog.accept());
});

test.afterAll(async () => {
  await page.close();
});

test("register, verify the email and create a workspace", async () => {
  await page.goto("/register");
  await page.getByLabel("Your name", { exact: true }).fill(owner.name);
  await page.getByLabel("Email", { exact: true }).fill(owner.email);
  await page.getByLabel("Password", { exact: true }).fill(owner.password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/verify-email/);

  const mail = await lastEmailTo(owner.email);
  await page.goto(firstLink(mail.text));
  await expect(page).toHaveURL(/\/onboarding/);

  await page.getByLabel("Business or workspace name").fill(`E2E Shop ${run}`);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL(/\/app$/);
});

test("connect a WhatsApp Cloud API number", async () => {
  await page.goto("/app/settings/numbers");
  await page.getByRole("button", { name: "Add number" }).first().click();
  await page.getByText("Official Cloud API").click();
  await page.getByLabel("Name", { exact: true }).fill("Support");
  await page.getByLabel("Phone number ID").fill(number.phoneNumberId);
  await page.getByLabel("WhatsApp Business Account ID").fill(number.wabaId);
  await page.getByLabel("Access token").fill(number.accessToken);
  await page.getByLabel("App secret").fill(number.appSecret);
  await page.getByRole("button", { name: "Verify and connect" }).click();
  await expect(page.getByText("Webhook setup")).toBeVisible();

  const res = await page.request.get("/api/whatsapp/accounts");
  const { accounts } = (await res.json()) as { accounts: { id: string; name: string; status: string }[] };
  const account = accounts.find((a) => a.name === "Support");
  expect(account?.status).toBe("CONNECTED");
  accountId = account!.id;
  await expect(page.getByRole("textbox", { name: "Callback URL" })).toHaveValue(`${APP_URL}/api/webhooks/whatsapp/${accountId}`);
});

test("an incoming message shows up in the inbox and the agent replies", async () => {
  await receiveText({ accountId, ...number, from: customer.phone, name: customer.name, text: "Hello, is my order shipped?" });

  await page.goto("/app/inbox");
  await page.getByText(customer.name).first().click();
  await expect(page.getByText("Hello, is my order shipped?")).toBeVisible();

  const reply = `Yes, it ships today (${run})`;
  await page.getByPlaceholder("Type a message — / for canned replies").fill(reply);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText(reply)).toBeVisible();
  await expectSent((m) => m.to === customer.phone && m.text === reply, "the agent's reply reaches the Cloud API");
});

test("sync approved templates from Meta", async () => {
  await page.goto("/app/templates");
  await page.getByRole("button", { name: "Sync from Meta" }).click();
  await expect(page.getByText(APPROVED_TEMPLATE.name).first()).toBeVisible();
});

test("send a template campaign to all contacts", async () => {
  await page.goto("/app/campaigns");
  await page.getByRole("button", { name: "New campaign" }).first().click();
  await page.getByLabel("Campaign name").fill(`Shipping update ${run}`);
  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(page).toHaveURL(/\/app\/campaigns\/[^/]+$/);

  await page.getByText("All contacts").click();
  await page.getByLabel("Template", { exact: true }).selectOption({ label: `${APPROVED_TEMPLATE.name} (${APPROVED_TEMPLATE.language})` });
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText(/Ready to send to 1 contact/)).toBeVisible();

  await page.getByRole("button", { name: "Launch campaign" }).click();
  await expectSent((m) => m.to === customer.phone && m.template === APPROVED_TEMPLATE.name, "the campaign template is sent");
  await expect(page.getByText("Completed").first()).toBeVisible({ timeout: 30_000 });
});

test("a chatbot flow answers a keyword and asks follow-up questions", async () => {
  await page.goto("/app/automations");
  await page.getByRole("button", { name: "New flow" }).first().click();
  await page.getByLabel("Name", { exact: true }).fill(`Leads ${run}`);
  await page.getByText("Lead capture").click();
  await page.getByRole("button", { name: "Create flow" }).click();
  await expect(page).toHaveURL(/\/app\/automations\/[^/]+$/);

  await page.goto("/app/automations");
  await page.getByRole("switch", { name: `Turn Leads ${run} on or off` }).click();
  await expect(page.getByText("Flow is on")).toBeVisible();

  await receiveText({ accountId, ...number, from: lead.phone, name: lead.name, text: "demo" });
  await expectSent((m) => m.to === lead.phone && /What's your name\?/.test(m.text ?? ""), "the flow asks for the name");

  await receiveText({ accountId, ...number, from: lead.phone, name: lead.name, text: "Meera Shah" });
  await expectSent((m) => m.to === lead.phone && /Thanks Meera Shah! Your email address\?/.test(m.text ?? ""), "the flow asks for the email");
});
