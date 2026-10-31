import type { Server as HttpServer } from "node:http";
import { Client } from "pg";
import { Server } from "socket.io";
import { db } from "@/lib/db";
import { REALTIME_CHANNEL } from "@/lib/realtime";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth/token";

function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

/**
 * Socket.IO on the app's HTTP server. Sockets authenticate with the session cookie and join
 * `user:<id>` plus `org:<id>` for every organization the user belongs to.
 */
export async function attachRealtime(httpServer: HttpServer) {
  const io = new Server(httpServer, {
    path: "/socket.io",
    // Leave other upgrade requests (Next.js dev HMR) alone
    destroyUpgrade: false,
    serveClient: false,
  });

  io.use(async (socket, next) => {
    const payload = verifySessionToken(readCookie(socket.handshake.headers.cookie, SESSION_COOKIE));
    if (!payload) return next(new Error("unauthorized"));
    const user = await db.user.findUnique({ where: { id: payload.sub }, select: { id: true, sessionVersion: true, emailVerifiedAt: true } });
    if (!user || user.sessionVersion !== payload.sv || !user.emailVerifiedAt) return next(new Error("unauthorized"));
    const [memberships, profile] = await Promise.all([
      db.membership.findMany({ where: { userId: user.id }, select: { orgId: true } }),
      db.user.findUnique({ where: { id: user.id }, select: { name: true } }),
    ]);
    socket.data.userId = user.id;
    socket.data.name = profile?.name ?? "";
    socket.data.orgIds = memberships.map((m) => m.orgId);
    next();
  });

  io.on("connection", (socket) => {
    socket.join(`user:${socket.data.userId}`);
    for (const orgId of socket.data.orgIds as string[]) socket.join(`org:${orgId}`);

    // Collision indicator: who is viewing / typing in a conversation. Relayed only to the
    // conversation's own workspace, after checking the sender belongs to it.
    socket.on("conversation.presence", async (msg: unknown) => {
      const { conversationId, state } = (msg ?? {}) as { conversationId?: unknown; state?: unknown };
      if (typeof conversationId !== "string" || !["viewing", "typing", "left"].includes(state as string)) return;
      const conversation = await db.conversation.findUnique({ where: { id: conversationId }, select: { orgId: true } }).catch(() => null);
      if (!conversation || !(socket.data.orgIds as string[]).includes(conversation.orgId)) return;
      socket.to(`org:${conversation.orgId}`).emit("conversation.presence", {
        conversationId,
        state,
        userId: socket.data.userId,
        name: socket.data.name,
      });
    });
  });

  // Forward NOTIFY events from any process to the right room; reconnect if Postgres drops
  const listen = async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    client.on("error", (err) => {
      console.error("[realtime] listener error, reconnecting in 5s:", err.message);
      setTimeout(() => void listen(), 5000);
    });
    client.on("notification", (msg) => {
      if (msg.channel !== REALTIME_CHANNEL || !msg.payload) return;
      try {
        const { room, event, data } = JSON.parse(msg.payload);
        if (typeof room === "string" && typeof event === "string") io.to(room).emit(event, data);
      } catch {
        // ignore malformed payloads
      }
    });
    await client.connect();
    await client.query(`LISTEN ${REALTIME_CHANNEL}`);
  };
  await listen();

  return io;
}
