import type { FlowTrigger } from "@/generated/prisma/client";
import { emptyGraph, type FlowGraph } from "./graph";

/** Ready-made flows to start from in the builder */
export const STARTERS: Record<string, { trigger: FlowTrigger; keywords: string[]; graph: () => FlowGraph }> = {
  blank: { trigger: "KEYWORD", keywords: [], graph: emptyGraph },

  // Greets new chats with a menu, collects a lead or hands over to a person
  welcome_menu: {
    trigger: "FIRST_MESSAGE",
    keywords: [],
    graph: () => ({
      nodes: [
        { id: "start", type: "start", position: { x: 260, y: 0 }, data: {} },
        {
          id: "menu",
          type: "menu",
          position: { x: 200, y: 120 },
          data: {
            text: "Hi {{first_name|there}} 👋 Welcome! How can we help you today?",
            options: [
              { id: "prices", title: "Prices & plans" },
              { id: "order", title: "Track my order" },
              { id: "human", title: "Talk to a person" },
            ],
            listButton: "Choose",
            saveAs: "topic",
          },
        },
        { id: "prices", type: "message", position: { x: -60, y: 360 }, data: { text: "Our plans start at ₹499/month. Reply here and a teammate will share the details." } },
        { id: "ask_order", type: "ask", position: { x: 240, y: 360 }, data: { text: "Please send your order number.", saveAs: "order_id", validation: "text" } },
        { id: "order_tag", type: "tags", position: { x: 240, y: 520 }, data: { add: ["Order enquiry"], remove: [] } },
        { id: "order_reply", type: "message", position: { x: 240, y: 660 }, data: { text: "Thanks! We're checking order {{order_id}} and will reply shortly." } },
        { id: "assign", type: "assign", position: { x: 560, y: 360 }, data: { mode: "round_robin" } },
        { id: "handoff", type: "end", position: { x: 560, y: 520 }, data: { text: "Connecting you to our team. Someone will reply here soon. 🙂", close: false } },
      ],
      edges: [
        { id: "e1", source: "start", sourceHandle: "next", target: "menu" },
        { id: "e2", source: "menu", sourceHandle: "prices", target: "prices" },
        { id: "e3", source: "menu", sourceHandle: "order", target: "ask_order" },
        { id: "e4", source: "menu", sourceHandle: "human", target: "assign" },
        { id: "e5", source: "ask_order", sourceHandle: "next", target: "order_tag" },
        { id: "e6", source: "order_tag", sourceHandle: "next", target: "order_reply" },
        { id: "e7", source: "assign", sourceHandle: "next", target: "handoff" },
      ],
    }),
  },

  // Collects name, email and city into the contact, tags the lead and alerts the team
  lead_capture: {
    trigger: "KEYWORD",
    keywords: ["demo", "price", "quote"],
    graph: () => ({
      nodes: [
        { id: "start", type: "start", position: { x: 0, y: 0 }, data: {} },
        { id: "ask_name", type: "ask", position: { x: -40, y: 120 }, data: { text: "Happy to help! What's your name?", saveAs: "lead_name", validation: "text", saveToField: "name" } },
        { id: "ask_email", type: "ask", position: { x: -40, y: 270 }, data: { text: "Thanks {{lead_name}}! Your email address?", saveAs: "lead_email", validation: "email", saveToField: "email" } },
        { id: "tag", type: "tags", position: { x: -40, y: 420 }, data: { add: ["Lead"], remove: [] } },
        { id: "optin", type: "setField", position: { x: -40, y: 560 }, data: { field: "opt_in", value: "" } },
        { id: "thanks", type: "end", position: { x: -40, y: 700 }, data: { text: "Got it, {{lead_name}}! Our team will contact you within one working day.", close: false } },
      ],
      edges: [
        { id: "e1", source: "start", sourceHandle: "next", target: "ask_name" },
        { id: "e2", source: "ask_name", sourceHandle: "next", target: "ask_email" },
        { id: "e3", source: "ask_email", sourceHandle: "next", target: "tag" },
        { id: "e4", source: "tag", sourceHandle: "next", target: "optin" },
        { id: "e5", source: "optin", sourceHandle: "next", target: "thanks" },
      ],
    }),
  },
};
