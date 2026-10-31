import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";

/**
 * Outbound HTTP to user-supplied URLs (flow webhooks, workspace webhooks, media links) must
 * never reach the server's own network: loopback, private ranges, cloud metadata (SSRF).
 *
 * ALLOW_PRIVATE_NETWORK_REQUESTS=true lifts the restriction for local development and tests
 * only; never set it on a public server.
 */

const blocked = new net.BlockList();
for (const [addr, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blocked.addSubnet(addr, prefix, "ipv4");
}
for (const [addr, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blocked.addSubnet(addr, prefix, "ipv6");
}

const allowPrivate = () => process.env.ALLOW_PRIVATE_NETWORK_REQUESTS === "true";

export function isBlockedAddress(address: string): boolean {
  if (allowPrivate()) return false;
  const mappedV4 = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mappedV4) return blocked.check(mappedV4[1]!, "ipv4");
  const family = net.isIP(address);
  if (family === 0) return true;
  return blocked.check(address, family === 4 ? "ipv4" : "ipv6");
}

// Checked on the connection itself, so DNS rebinding can't swap in a private address later
const safeLookup: net.LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    const cb = callback as (err: Error | null, address?: string | dns.LookupAddress[], family?: number) => void;
    if (err) return cb(err);
    const list = addresses as dns.LookupAddress[];
    if (!list.length || list.some((a) => isBlockedAddress(a.address))) return cb(new Error(`${hostname} resolves to a private or reserved address.`));
    if ((options as dns.LookupOptions).all) return cb(null, list);
    cb(null, list[0]!.address, list[0]!.family);
  });
};

export interface SafeResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

/** One request (redirects are not followed) to a public http(s) host, with a size-capped body */
export function safeRequest(
  url: string,
  opts: { method?: string; headers?: Record<string, string>; body?: string | Buffer; timeoutMs?: number; maxBytes?: number } = {},
): Promise<SafeResponse> {
  return new Promise((resolve, reject) => {
    let target: URL;
    try {
      target = new URL(url);
    } catch {
      return reject(new Error("Invalid URL."));
    }
    if (target.protocol !== "http:" && target.protocol !== "https:") return reject(new Error("Only http:// and https:// URLs are allowed."));
    const host = target.hostname.replace(/^\[|\]$/g, "");
    if (net.isIP(host) && isBlockedAddress(host)) return reject(new Error(`${host} is a private or reserved address.`));
    const timeoutMs = opts.timeoutMs ?? 10_000;
    const maxBytes = opts.maxBytes ?? 64 * 1024;
    const client = target.protocol === "https:" ? https : http;
    const req = client.request(target, { method: opts.method ?? "GET", headers: opts.headers, lookup: safeLookup, timeout: timeoutMs }, (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (c: Buffer) => {
        size += c.length;
        if (size > maxBytes) return res.destroy(new Error(`The response is larger than ${maxBytes} bytes.`));
        chunks.push(c);
      });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error(`No response within ${timeoutMs / 1000}s.`)));
    req.on("error", reject);
    req.end(opts.body);
  });
}
