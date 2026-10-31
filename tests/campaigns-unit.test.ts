import { describe, expect, it } from "vitest";
import { contactVariables, renderCampaignText, renderQrMessage, renderTemplateMessage, RenderError, resolveParam } from "@/lib/campaigns/render";
import { buildTemplatePayload, templateCreateSchema, templateSpec, toMetaComponents, variablesIn } from "@/lib/whatsapp/templates";

const promo = [
  { type: "HEADER", format: "IMAGE" },
  { type: "BODY", text: "Hi {{1}}, {{2}} off on {{3}}!" },
  { type: "FOOTER", text: "Reply STOP to opt out" },
  {
    type: "BUTTONS",
    buttons: [
      { type: "URL", text: "Shop", url: "https://shop.example/c/{{1}}" },
      { type: "QUICK_REPLY", text: "Not now" },
      { type: "COPY_CODE", text: "Copy code" },
    ],
  },
];

describe("template spec & payload", () => {
  it("reads variables, media headers and parameterised buttons", () => {
    expect(templateSpec(promo)).toEqual({
      header: { format: "IMAGE", vars: [] },
      body: ["1", "2", "3"],
      buttons: [
        { index: 0, type: "URL", vars: ["1"] },
        { index: 2, type: "COPY_CODE", vars: ["code"] },
      ],
      named: false,
    });
    expect(variablesIn("{{2}} then {{1}} and {{2}}")).toEqual(["1", "2"]);
    expect(variablesIn("Hi {{first_name}}, order {{order_id}}")).toEqual(["first_name", "order_id"]);
  });

  it("builds the Cloud API payload with media, buttons and named variables", () => {
    expect(buildTemplatePayload("promo", "en", { body: ["Ravi", "20%", "shoes"], headerMedia: { id: "MEDIA1" }, buttons: { 0: "summer", 2: "SAVE20" } }, promo)).toEqual({
      name: "promo",
      language: { code: "en" },
      components: [
        { type: "header", parameters: [{ type: "image", image: { id: "MEDIA1" } }] },
        { type: "body", parameters: ["Ravi", "20%", "shoes"].map((text) => ({ type: "text", text })) },
        { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: "summer" }] },
        { type: "button", sub_type: "copy_code", index: "2", parameters: [{ type: "coupon_code", coupon_code: "SAVE20" }] },
      ],
    });
    const named = [{ type: "BODY", text: "Hi {{first_name}}" }];
    expect(buildTemplatePayload("n", "en", { body: ["Asha"] }, named).components).toEqual([{ type: "body", parameters: [{ type: "text", parameter_name: "first_name", text: "Asha" }] }]);
  });
});

describe("template builder validation", () => {
  const base = { accountId: "a", name: "order_update", language: "en_US", category: "UTILITY", body: { text: "Hi {{1}}, your order {{2}} shipped.", examples: ["Ravi", "#12"] } };

  it("accepts a valid template and produces Meta components", () => {
    const t = templateCreateSchema.parse({ ...base, header: { format: "IMAGE" }, footer: "Thanks", buttons: [{ type: "URL", text: "Track", url: "https://t.example/{{1}}", example: "https://t.example/12" }] });
    expect(toMetaComponents(t, "HANDLE")).toEqual([
      { type: "HEADER", format: "IMAGE", example: { header_handle: ["HANDLE"] } },
      { type: "BODY", text: "Hi {{1}}, your order {{2}} shipped.", example: { body_text: [["Ravi", "#12"]] } },
      { type: "FOOTER", text: "Thanks" },
      { type: "BUTTONS", buttons: [{ type: "URL", text: "Track", url: "https://t.example/{{1}}", example: ["https://t.example/12"] }] },
    ]);
  });

  it.each([
    [{ name: "Order Update" }, /lowercase/],
    [{ body: { text: "Hi {{1}}, order {{3}}.", examples: ["a", "b"] } }, /without gaps/],
    [{ body: { text: "{{1}} is ready", examples: ["a"] } }, /start or end/],
    [{ body: { text: "Hi {{1}}, done.", examples: [] } }, /example/],
    [{ buttons: [{ type: "URL", text: "Go", url: "http://insecure.example" }] }, /https/],
    [{ buttons: [{ type: "QUICK_REPLY", text: "A" }, { type: "URL", text: "B", url: "https://x.example" }, { type: "QUICK_REPLY", text: "C" }] }, /together/],
  ])("rejects %j", (patch, message) => {
    const res = templateCreateSchema.safeParse({ ...base, ...patch });
    expect(res.success).toBe(false);
    expect(res.error!.issues.map((i) => i.message).join(" ")).toMatch(message);
  });
});

describe("campaign rendering", () => {
  const ravi = contactVariables({ phone: "919000012345", name: "Ravi Mehra", waName: null, email: null, fields: { city: "Delhi", vip: true } });
  const nameless = contactVariables({ phone: "919811100000", name: null, waName: null, email: null, fields: {} });

  it("fills variables with fallbacks and spins", () => {
    expect(renderCampaignText("Hi {{first_name|there}} from {{city}}!", ravi)).toBe("Hi Ravi from Delhi!");
    expect(renderCampaignText("Hi {{first_name|there}}!", nameless)).toBe("Hi there!");
    expect(["Hello Ravi", "Hi Ravi"]).toContain(renderCampaignText("{Hello|Hi} {{first_name}}", ravi));
    // Values are never treated as spintax
    expect(renderCampaignText("Code: {{code}}", { code: "{A|B}" })).toBe("Code: {A|B}");
    expect(renderCampaignText("VIP: {{vip}}, {{missing}} done", ravi)).toBe("VIP: Yes, done");
  });

  it("resolves template parameter sources", () => {
    expect(resolveParam({ source: "first_name", value: "" }, ravi)).toBe("Ravi");
    expect(resolveParam({ source: "field:city", value: "your city" }, nameless)).toBe("your city");
    expect(resolveParam({ source: "text", value: " SALE20 " }, ravi)).toBe("SALE20");
  });

  it("skips a contact when a template value is missing", () => {
    const tpl = { id: "t", name: "promo", language: "en", components: [{ type: "BODY", text: "Hi {{1}}, see you in {{2}}." }] };
    const ok = renderTemplateMessage(tpl, { header: [], body: [{ source: "first_name", value: "" }, { source: "field:city", value: "" }], buttons: {} }, ravi, null);
    expect(ok.body).toBe("Hi Ravi, see you in Delhi.");
    expect(() => renderTemplateMessage(tpl, { header: [], body: [{ source: "first_name", value: "" }, { source: "field:city", value: "" }], buttons: {} }, nameless, null)).toThrow(RenderError);
    expect(() => renderTemplateMessage({ ...tpl, components: promo }, { header: [], body: [], buttons: {} }, ravi, null)).toThrow(RenderError);
  });

  it("builds QR messages", () => {
    expect(renderQrMessage("Hi {{first_name}}", null, ravi)).toEqual({ type: "TEXT", body: "Hi Ravi", media: null, payload: null });
    expect(renderQrMessage(null, { storageKey: "o/x.jpg", mimeType: "image/jpeg", fileName: "x.jpg" }, ravi).type).toBe("IMAGE");
    expect(() => renderQrMessage("  ", null, ravi)).toThrow(RenderError);
  });
});
