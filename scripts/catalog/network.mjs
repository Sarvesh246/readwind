import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { isIP } from "node:net";
export function publicAddress(address) {
  const a = address.toLowerCase();
  if (isIP(a) === 4) {
    const n = a.split(".").map(Number);
    return !(
      n[0] === 0 ||
      n[0] === 10 ||
      n[0] === 127 ||
      n[0] >= 224 ||
      (n[0] === 169 && n[1] === 254) ||
      (n[0] === 172 && n[1] >= 16 && n[1] <= 31) ||
      (n[0] === 192 && (n[1] === 168 || n[1] === 0)) ||
      (n[0] === 100 && n[1] >= 64 && n[1] <= 127) ||
      (n[0] === 198 && (n[1] === 18 || n[1] === 19))
    );
  }
  return (
    isIP(a) === 6 &&
    !/^(::|fc|fd|fe[89ab]|ff|2001:db8)/i.test(a) &&
    !a.includes(".")
  );
}
export const defaultHosts = [
  "www.gutenberg.org",
  "gutenberg.org",
  "aleph.gutenberg.org",
  "api.thoth.pub",
  "library.oapen.org",
  "www.openbookpublishers.com",
  "cdn.openbookpublishers.com",
  "books.openbookpublishers.com",
];
const lastRequest = new Map();
export async function download(
  url,
  {
    hosts = defaultHosts,
    maxBytes = 20 * 1024 * 1024,
    method = "GET",
    body,
    redirects = 0,
    delay = 2000,
  } = {},
) {
  const target = new URL(url);
  if (
    target.protocol !== "https:" ||
    target.username ||
    target.password ||
    (target.port && target.port !== "443") ||
    !hosts.includes(target.hostname)
  )
    throw new Error(
      `Source URL is not on the approved HTTPS host list (${target.protocol}//${target.hostname}).`,
    );
  const addresses = await lookup(target.hostname, { all: true });
  if (!addresses.length || addresses.some((r) => !publicAddress(r.address)))
    throw new Error("Private or reserved network destination blocked.");
  const wait = Math.max(
    0,
    (lastRequest.get(target.hostname) || 0) + delay - Date.now(),
  );
  if (wait) await new Promise((r) => setTimeout(r, wait));
  lastRequest.set(target.hostname, Date.now());
  const pinned = addresses[0];
  return new Promise((resolve, reject) => {
    const req = request(
      target,
      {
        method,
        headers: {
          "User-Agent":
            "Readwind catalog preparation (personal library; contact via github.com/Sarvesh246/readwind)",
          ...(body
            ? {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(body),
              }
            : {}),
        },
        lookup: (_host, options, callback) =>
          options.all
            ? callback(null, [pinned])
            : callback(null, pinned.address, pinned.family),
      },
      (res) => {
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          res.resume();
          if (redirects >= 4) {
            reject(new Error("Too many source redirects."));
            return;
          }
          download(new URL(res.headers.location, target).href, {
            hosts,
            maxBytes,
            method,
            body,
            redirects: redirects + 1,
            delay,
          }).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`Source HTTP ${res.statusCode}`));
          return;
        }
        const length = Number(res.headers["content-length"]);
        if (length > maxBytes) {
          res.destroy();
          reject(new Error("Source exceeds size limit."));
          return;
        }
        let size = 0;
        const chunks = [];
        res.on("data", (chunk) => {
          size += chunk.length;
          if (size > maxBytes) {
            res.destroy(new Error("Source exceeds size limit."));
            return;
          }
          chunks.push(chunk);
        });
        res.on("error", reject);
        res.on("end", () =>
          resolve({
            bytes: Buffer.concat(chunks),
            type: String(res.headers["content-type"] || "").split(";")[0],
            url: target.href,
          }),
        );
      },
    );
    req.setTimeout(30000, () =>
      req.destroy(new Error("Source request timed out.")),
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}
