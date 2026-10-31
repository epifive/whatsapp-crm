import crypto from "node:crypto";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { ALL_FEATURES, UNLIMITED, type PlanFeatures, type PlanLimits } from "@/lib/billing/plans";
import { DEFAULT_STAGES } from "@/lib/crm/pipelines";
import { STARTERS } from "@/lib/flows/starters";
import { slugify } from "@/lib/orgs";

/**
 * Sample data so a fresh install has something to look at: a "Demo Store" workspace owned by
 * the given user with contacts, chats, deals, tasks, a finished campaign, a chatbot flow and an
 * AI knowledge base, plus four ready-made plans (billing itself stays off). Safe to run twice:
 * it does nothing if the demo workspace exists.
 */

const FIRST = ["Aarav", "Priya", "Rohan", "Ananya", "Vikram", "Sneha", "Arjun", "Kavya", "Rahul", "Isha", "Karan", "Meera", "Aditya", "Pooja", "Siddharth", "Neha", "Manish", "Divya", "Nikhil", "Riya", "Amit", "Shreya", "Varun", "Tanvi", "Harsh", "Anjali", "Yash", "Nisha", "Kunal", "Simran"];
const LAST = ["Sharma", "Patel", "Iyer", "Reddy", "Singh", "Gupta", "Nair", "Mehta", "Joshi", "Kapoor", "Desai", "Rao", "Verma", "Bose", "Malhotra"];
const CITIES = ["Mumbai", "Delhi", "Bengaluru", "Pune", "Hyderabad", "Chennai", "Ahmedabad", "Jaipur", "Kolkata", "Lucknow"];

const CHATS: { from: string[]; to: string[]; status: "OPEN" | "PENDING" | "CLOSED"; unread: number }[] = [
  { from: ["Hi! Is the blue kurta in the new collection available in size L?", "Also do you deliver to Pune?"], to: ["Hi! Yes, size L is in stock 😊", "We deliver across Pune in 1-2 days, free above ₹999."], status: "OPEN", unread: 1 },
  { from: ["My order #4821 hasn't arrived yet"], to: ["Sorry about that! Let me check with the courier and get back to you in a few minutes."], status: "OPEN", unread: 0 },
  { from: ["Do you have a wholesale price list?", "We run 3 stores in Jaipur"], to: [], status: "OPEN", unread: 2 },
  { from: ["Thanks, received the parcel. Quality is great!"], to: ["So glad you liked it! Would you mind leaving us a review? 🙏"], status: "CLOSED", unread: 0 },
  { from: ["What are your shop timings on Sunday?"], to: ["We're open 11am to 7pm on Sundays."], status: "CLOSED", unread: 0 },
  { from: ["Can I exchange a size?"], to: ["Of course! Exchanges are free within 7 days. Just reply with your order number."], status: "PENDING", unread: 0 },
  { from: ["Hello, is the Diwali offer still on?"], to: ["Yes! 20% off on all festive wear till Sunday. Use code DIWALI20 at checkout."], status: "OPEN", unread: 1 },
  { from: ["Please call me back about bulk order for my office"], to: [], status: "OPEN", unread: 1 },
];

function demoPrices(currency: string): [number, number][] {
  // [monthly, yearly] in the smallest unit for Free / Starter / Pro / Business
  if (currency === "INR") return [[0, 0], [99_900, 999_000], [249_900, 2_499_000], [499_900, 4_999_000]];
  return [[0, 0], [1_900, 19_000], [4_900, 49_000], [9_900, 99_000]];
}

/** Four plans to start from (only when there are none yet) */
export async function seedDefaultPlans(currency: string) {
  if (await db.plan.count()) return;
  const prices = demoPrices(currency);
  const plans: { name: string; description: string; trialDays: number; limits: PlanLimits; features: PlanFeatures }[] = [
    { name: "Free", description: "Try the inbox with one number", trialDays: 0, limits: { numbers: 1, members: 1, contacts: 250, campaignsPerMonth: 0, flows: 1 }, features: { ...ALL_FEATURES, campaigns: false, ai: false, api: false, webhooks: false } },
    { name: "Starter", description: "For small shops", trialDays: 14, limits: { numbers: 1, members: 3, contacts: 2_000, campaignsPerMonth: 10, flows: 5 }, features: { ...ALL_FEATURES, api: false, webhooks: false } },
    { name: "Pro", description: "For growing teams", trialDays: 14, limits: { numbers: 3, members: 10, contacts: 20_000, campaignsPerMonth: 50, flows: 25 }, features: ALL_FEATURES },
    { name: "Business", description: "Everything, without limits", trialDays: 14, limits: { numbers: 10, members: UNLIMITED, contacts: UNLIMITED, campaignsPerMonth: UNLIMITED, flows: UNLIMITED }, features: ALL_FEATURES },
  ];
  await db.plan.createMany({ data: plans.map((p, i) => ({ ...p, priceMonthly: prices[i]![0], priceYearly: prices[i]![1], sortOrder: i })) });
}

const pick = <T>(list: T[], i: number) => list[i % list.length]!;
const ago = (now: number, minutes: number) => new Date(now - minutes * 60_000);

export async function seedDemo(ownerId: string, opts: { currency?: string; teammateId?: string } = {}) {
  await seedDefaultPlans(opts.currency ?? "USD");
  if (await db.organization.findFirst({ where: { name: "Demo Store", memberships: { some: { userId: ownerId } } } })) return null;
  const now = Date.now();

  const org = await db.organization.create({
    data: { name: "Demo Store", slug: slugify("demo-store"), timezone: "Asia/Kolkata", currency: "INR", memberships: { create: { userId: ownerId, role: "OWNER" } } },
  });
  const orgId = org.id;

  // Two teammates (they can't sign in: random passwords; reset them to try the agent view).
  // The live demo passes its own agent account as the first one.
  const agents: string[] = [];
  if (opts.teammateId) {
    await db.membership.create({ data: { orgId, userId: opts.teammateId, role: "AGENT" } });
    agents.push(opts.teammateId);
  }
  for (const [name, handle] of ([["Riya Kapoor", "riya"], ["Arjun Mehta", "arjun"]] as const).slice(agents.length)) {
    const email = `${handle}.${orgId.slice(-6)}@demo.example.com`;
    const user = await db.user.create({ data: { email, name, passwordHash: hashPassword(crypto.randomBytes(24).toString("base64url")), emailVerifiedAt: new Date() } });
    await db.membership.create({ data: { orgId, userId: user.id, role: "AGENT" } });
    agents.push(user.id);
  }
  const team = [ownerId, ...agents];

  // A QR number that isn't connected (connect your own in Settings › WhatsApp numbers)
  const account = await db.whatsAppAccount.create({ data: { orgId, name: "Demo number", channel: "QR", status: "DISCONNECTED", phone: "919800000000", displayName: "Demo Store" } });

  const tags = await Promise.all(
    [
      ["VIP", "#ca8a04"],
      ["Customer", "#16a34a"],
      ["Lead", "#2563eb"],
      ["Wholesale", "#9333ea"],
    ].map(([name, color]) => db.tag.create({ data: { orgId, name: name!, color: color! } })),
  );
  await db.customField.createMany({
    data: [
      { orgId, key: "city", label: "City", type: "TEXT", position: 0 },
      { orgId, key: "customer_type", label: "Customer type", type: "SELECT", options: ["Retail", "Wholesale"], position: 1 },
    ],
  });

  const contacts: { id: string }[] = [];
  for (let i = 0; i < 40; i++) {
    const name = `${pick(FIRST, i)} ${pick(LAST, i * 7)}`;
    const c = await db.contact.create({
      data: {
        orgId,
        phone: `9198${String(10000000 + i * 7919).slice(0, 8)}`,
        name,
        email: i % 3 === 0 ? `${name.toLowerCase().replace(" ", ".")}@example.com` : null,
        source: i % 4 === 0 ? "import" : "whatsapp",
        optedInAt: i % 5 === 0 ? null : ago(now, 60 * 24 * (i + 1)),
        optInSource: i % 5 === 0 ? null : "whatsapp",
        ownerId: pick(team, i),
        fields: { city: pick(CITIES, i), customer_type: i % 6 === 0 ? "Wholesale" : "Retail" },
        createdAt: ago(now, 60 * 24 * (40 - i)),
      },
    });
    contacts.push(c);
  }
  await db.contactTag.createMany({
    data: contacts.flatMap((c, i) => [
      { contactId: c.id, tagId: tags[i % 3 === 0 ? 2 : 1]!.id },
      ...(i % 7 === 0 ? [{ contactId: c.id, tagId: tags[0]!.id }] : []),
      ...(i % 6 === 0 ? [{ contactId: c.id, tagId: tags[3]!.id }] : []),
    ]),
  });
  await db.segment.create({ data: { orgId, name: "VIP customers", description: "Tagged VIP", filter: { match: "all", conditions: [{ type: "tag", op: "has", tagId: tags[0]!.id }] } } });

  // Inbox
  for (const [i, chat] of CHATS.entries()) {
    const contact = contacts[i]!;
    // Unread only when the customer wrote last
    const unread = chat.to.length ? 0 : chat.unread;
    const conv = await db.conversation.create({ data: { orgId, accountId: account.id, contactId: contact.id, status: chat.status, assigneeId: i % 3 === 2 ? null : pick(team, i), unreadCount: unread } });
    let t = 60 * (i * 5 + 3);
    const lines: { dir: "INBOUND" | "OUTBOUND"; body: string }[] = [];
    chat.from.forEach((b) => lines.push({ dir: "INBOUND", body: b }));
    chat.to.forEach((b) => lines.push({ dir: "OUTBOUND", body: b }));
    let last: { body: string; at: Date; inboundAt: Date | null } = { body: "", at: new Date(), inboundAt: null };
    for (const line of lines) {
      const at = ago(now, (t -= 2));
      await db.message.create({
        data: { orgId, conversationId: conv.id, accountId: account.id, direction: line.dir, type: "TEXT", body: line.body, status: line.dir === "INBOUND" ? "RECEIVED" : "READ", sentById: line.dir === "OUTBOUND" ? pick(team, i) : null, createdAt: at },
      });
      last = { body: line.body, at, inboundAt: line.dir === "INBOUND" ? at : last.inboundAt };
    }
    await db.conversation.update({ where: { id: conv.id }, data: { lastMessageAt: last.at, lastMessagePreview: last.body.slice(0, 120), lastInboundAt: last.inboundAt } });
  }
  await db.cannedResponse.createMany({
    data: [
      { orgId, shortcut: "hi", title: "Greeting", body: "Hi {{first_name|there}}! Thanks for writing to Demo Store. How can we help?" },
      { orgId, shortcut: "delivery", title: "Delivery times", body: "We deliver in 1-2 days in metro cities and 3-5 days elsewhere. Delivery is free above ₹999." },
      { orgId, shortcut: "returns", title: "Returns", body: "Returns and exchanges are free within 7 days of delivery. Just send us your order number." },
      { orgId, shortcut: "thanks", title: "Thank you", body: "Thank you for shopping with us! 🙏" },
    ],
  });

  // Deals
  const pipeline = await db.pipeline.create({ data: { orgId, name: "Sales pipeline", stages: { create: DEFAULT_STAGES.map((s, position) => ({ ...s, orgId, position })) } }, include: { stages: { orderBy: { position: "asc" } } } });
  const dealNames = ["Bulk order: office uniforms", "Wedding collection (40 pcs)", "Jaipur store restock", "Corporate Diwali gifts", "Boutique partnership", "School uniforms 2027", "Festive hampers", "Hotel staff uniforms", "Monthly restock: Lucknow", "Anniversary sale order"];
  for (const [i, title] of dealNames.entries()) {
    const stage = pipeline.stages[i % pipeline.stages.length]!;
    await db.deal.create({
      data: {
        orgId,
        pipelineId: pipeline.id,
        stageId: stage.id,
        contactId: contacts[i + 2]!.id,
        ownerId: pick(team, i),
        title,
        value: [45000, 120000, 32000, 85000, 60000, 240000, 18000, 95000, 27000, 54000][i]!,
        currency: "INR",
        status: stage.kind,
        position: i,
        closedAt: stage.kind === "OPEN" ? null : ago(now, 60 * 24 * i),
        expectedCloseAt: new Date(now + (i + 3) * 86_400_000),
      },
    });
  }
  const tasks = ["Send the wholesale price list", "Call back about the bulk order", "Confirm courier pickup for #4821", "Share Diwali catalogue", "Follow up on the proposal"];
  // Marked as reminded: demo tasks shouldn't email the (made-up) teammates
  await db.task.createMany({
    data: tasks.map((title, i) => ({ orgId, title, assigneeId: pick(team, i), createdById: ownerId, contactId: contacts[i + 1]!.id, dueAt: new Date(now + (i - 1) * 86_400_000), reminderSentAt: new Date(now) })),
  });

  // A finished campaign with its report
  const campaign = await db.campaign.create({
    data: {
      orgId,
      name: "Diwali sale announcement",
      accountId: account.id,
      status: "COMPLETED",
      audience: { type: "tags", tagIds: [tags[1]!.id], consent: "opted_in" },
      body: "Hi {{first_name|there}}! 🪔 {Our Diwali sale is live|The Diwali sale has started}: 20% off all festive wear till Sunday. Reply STOP to opt out.",
      startedAt: ago(now, 60 * 24 * 3),
      completedAt: ago(now, 60 * 24 * 3 - 90),
      createdById: ownerId,
    },
  });
  const statuses = ["READ", "READ", "READ", "DELIVERED", "DELIVERED", "SENT", "FAILED"] as const;
  const recipients = contacts.slice(0, 28);
  await db.campaignRecipient.createMany({
    data: recipients.map((c, i) => ({ orgId, campaignId: campaign.id, contactId: c.id, status: pick([...statuses], i), sentAt: ago(now, 60 * 24 * 3 - i), error: pick([...statuses], i) === "FAILED" ? "Number not on WhatsApp" : null, repliedAt: i % 9 === 0 ? ago(now, 60 * 24 * 2) : null })),
  });
  await db.campaign.update({ where: { id: campaign.id }, data: { total: recipients.length } });

  // Automations and AI (the AI needs your own API key in Settings › AI assistant)
  const welcome = STARTERS.welcome_menu!;
  await db.flow.create({ data: { orgId, name: "Welcome menu", trigger: welcome.trigger, keywords: welcome.keywords, graph: welcome.graph() as never, isActive: false, createdById: ownerId } });
  await db.aiConfig.create({ data: { orgId, instructions: "You are the assistant of Demo Store, a clothing shop in Pune. Be short and friendly. Reply in the customer's language." } });
  await db.knowledgeArticle.createMany({
    data: [
      { orgId, title: "Delivery", content: "We deliver across India. Metro cities: 1-2 days. Other cities: 3-5 days. Delivery is free on orders above ₹999, otherwise ₹79." },
      { orgId, title: "Returns and exchanges", content: "Returns and exchanges are free within 7 days of delivery if the product is unused and has its tags. Refunds reach the original payment method in 5-7 working days." },
      { orgId, title: "Store timings", content: "Our Pune store (FC Road) is open 10am to 9pm Monday to Saturday and 11am to 7pm on Sunday." },
    ],
  });
  return orgId;
}
