/**
 * App entry: Next.js + Socket.IO on one HTTP server.
 *   development:  npm run dev
 *   production:   npm run build && npm start   (run the worker too: npm run worker)
 */
import "dotenv/config";
import { createServer } from "node:http";
import next from "next";
import { isInstalled } from "@/lib/install-state";
import { attachRealtime } from "@/server/realtime-server";

// Before the web installer has run, every page leads to it; afterwards it is closed
const INSTALLER_PATHS = ["/install", "/api/install"];
const ALWAYS_OPEN = ["/_next/", "/favicon.ico", "/robots.txt"];

function installGate(url: string): { redirect?: string; status?: number } | null {
  const path = url.split("?")[0]!;
  const isInstaller = INSTALLER_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
  if (ALWAYS_OPEN.some((p) => path.startsWith(p))) return null;
  if (isInstalled()) return isInstaller ? (path.startsWith("/api/") ? { status: 404 } : { redirect: "/login" }) : null;
  if (isInstaller) return null;
  return path.startsWith("/api/") || path.startsWith("/socket.io/") ? { status: 503 } : { redirect: "/install" };
}

const dev = process.env.NODE_ENV !== "production";
const port = Number(process.env.PORT) || 3000;
const hostname = process.env.HOST || "0.0.0.0";

async function main() {
  const httpServer = createServer();
  const app = next({ dev, hostname, port, httpServer });
  const handle = app.getRequestHandler();
  await app.prepare();

  httpServer.on("request", (req, res) => {
    const gate = installGate(req.url ?? "/");
    if (gate?.redirect) {
      res.writeHead(302, { Location: gate.redirect });
      return res.end();
    }
    if (gate?.status) {
      res.writeHead(gate.status, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: gate.status === 503 ? "The app isn't installed yet. Open /install." : "Not found." }));
    }
    // Socket.IO handles its own path
    if (req.url?.startsWith("/socket.io/")) return;
    handle(req, res);
  });
  // Realtime needs the database and APP_KEY; before installation it starts with the first request after it
  if (isInstalled()) await attachRealtime(httpServer);
  else {
    const waitForInstall = setInterval(() => {
      if (!isInstalled()) return;
      clearInterval(waitForInstall);
      attachRealtime(httpServer).catch((err) => console.error("Realtime failed to start:", err));
    }, 3000);
  }

  httpServer.listen(port, hostname, () => {
    console.log(`> CRM for WhatsApp ready on http://localhost:${port} (${dev ? "development" : "production"})`);
    if (!isInstalled()) console.log(`> Not installed yet: open http://localhost:${port}/install to set it up`);
  });
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
