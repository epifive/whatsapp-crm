import { createServer, type Server } from "node:http";

/**
 * A fake Meta Graph API (the app points at it through WHATSAPP_GRAPH_BASE). It accepts any
 * phone number id / WABA id, returns one approved template and records every message the app
 * sends; tests read them from GET /__e2e/messages.
 */
export const APPROVED_TEMPLATE = {
  id: "9000000001",
  name: "order_update",
  language: "en",
  category: "UTILITY",
  status: "APPROVED",
  components: [{ type: "BODY", text: "Hi {{1}}, your order is on its way.", example: { body_text: [["Asha"]] } }],
};

export interface SentMessage {
  phoneNumberId: string;
  to: string;
  type: string;
  text?: string;
  template?: string;
  payload: Record<string, unknown>;
}

export function startMockMeta(port: number): Promise<Server> {
  const sent: SentMessage[] = [];
  let nextId = 1;

  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks).toString();
    const url = new URL(req.url ?? "/", "http://mock");
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };

    if (url.pathname === "/__e2e/messages") {
      if (req.method === "DELETE") sent.length = 0;
      return json(200, { messages: sent });
    }
    if (!req.headers.authorization?.startsWith("Bearer ")) return json(401, { error: { message: "Missing token", code: 190 } });

    // /v23.0/<id>[/<edge>]
    const [, , id, edge] = url.pathname.split("/");
    if (!id) return json(404, { error: { message: "Unknown path" } });

    if (!edge && req.method === "GET") {
      return json(200, { id, display_phone_number: "+1 555-010-0100", verified_name: "E2E Store", quality_rating: "GREEN", messaging_limit_tier: "TIER_1K" });
    }
    if (edge === "subscribed_apps") return json(200, { success: true });
    if (edge === "message_templates" && req.method === "GET") return json(200, { data: [APPROVED_TEMPLATE] });
    if (edge === "message_templates" && req.method === "POST") return json(200, { id: `90000${nextId++}`, status: "PENDING", category: "UTILITY" });
    if (edge === "messages" && req.method === "POST") {
      const body = JSON.parse(raw || "{}") as Record<string, unknown>;
      if (body.status === "read") return json(200, { success: true });
      const text = (body.text as { body?: string } | undefined)?.body;
      const template = (body.template as { name?: string } | undefined)?.name;
      const interactive = body.interactive as { body?: { text?: string } } | undefined;
      sent.push({
        phoneNumberId: id,
        to: String(body.to),
        type: String(body.type),
        text: text ?? interactive?.body?.text,
        template,
        payload: body,
      });
      return json(200, { messaging_product: "whatsapp", messages: [{ id: `wamid.E2E${Date.now()}${nextId++}` }] });
    }
    return json(404, { error: { message: `Mock Meta has no route for ${req.method} ${url.pathname}` } });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}
