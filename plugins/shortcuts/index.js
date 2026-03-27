/**
 * Shortcuts Plugin
 * Adds a configurable shortcuts grid to the degoog home page.
 * Shortcuts are stored in the browser's localStorage (per-browser/user).
 * Server-side settings define the default shortcuts that are used when
 * a browser has no locally stored shortcuts yet.
 */

/** Current defaults from settings (may be overridden by configure()) */
let defaultShortcuts = [];

/** Parse the urllist setting into shortcut objects */
function parseShortcutList(rawList) {
  if (!Array.isArray(rawList) || rawList.length === 0) return null;
  const shortcuts = [];
  for (const entry of rawList) {
    if (!entry || typeof entry !== "string") continue;
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const parts = trimmed.split("|");
    if (parts.length < 2) continue;
    const label = parts[0].trim();
    const url   = parts[1].trim();
    const color = (parts[2] || "").trim() || null;
    if (!label || !url) continue;
    shortcuts.push({
      id:    label.toLowerCase().replace(/[^a-z0-9]/g, "-").slice(0, 16),
      label,
      url,
      color: color || null,
    });
  }
  return shortcuts.length > 0 ? shortcuts : null;
}

// ─── Icon fetching helpers ────────────────────────────────────────────────────

const FETCH_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function decodeEntities(str) {
  return str
    .replace(/&amp;/g,  "&")
    .replace(/&lt;/g,   "<")
    .replace(/&gt;/g,   ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'");
}

// Resolve a relative URL against the page URL
function resolveUrl(href, pageUrl) {
  href = (href || "").trim();
  if (!href) return null;
  try { return new URL(href, pageUrl).href; } catch { return null; }
}

// Extract icon candidates from HTML <link> tags, ordered best-first.
function extractIconCandidates(html, pageUrl) {
  // Match all <link ...> or <link ... />
  const linkRe  = /<link([^>]+?)(?:\/>|>)/gi;
  // Allow quoted or unquoted attribute values
  const relRe   = /\brel\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>\/]+))/i;
  const hrefRe  = /\bhref\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>\/]+))/i;
  const sizesRe = /\bsizes\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>\/]+))/i;

  const candidates = [];
  let m;
  while ((m = linkRe.exec(html)) !== null) {
    const attrs     = m[1];
    const relMatch  = relRe.exec(attrs);
    const hrefMatch = hrefRe.exec(attrs);
    if (!relMatch || !hrefMatch) continue;

    const rel  = (relMatch[1]  || relMatch[2]  || relMatch[3]  || "").toLowerCase().trim();
    const href = (hrefMatch[1] || hrefMatch[2] || hrefMatch[3] || "").trim();
    if (!href || !rel.includes("icon")) continue;

    const sizesMatch = sizesRe.exec(attrs);
    const sizes = sizesMatch ? (sizesMatch[1] || sizesMatch[2] || sizesMatch[3] || "") : "";
    const isApple = rel.includes("apple-touch-icon");
    const dim = sizes
      ? Math.max(0, ...sizes.trim().split(/\s+/).map(s => parseInt(s) || 0))
      : 0;

    const resolved = resolveUrl(href, pageUrl);
    if (resolved) candidates.push({ url: resolved, isApple, dim });
  }

  // Sort: apple-touch-icon first, then largest declared size
  candidates.sort((a, b) => {
    if (a.isApple !== b.isApple) return a.isApple ? -1 : 1;
    return b.dim - a.dim;
  });

  // Always include /favicon.ico as last resort
  try {
    const faviconIco = new URL(pageUrl).origin + "/favicon.ico";
    if (!candidates.some(c => c.url === faviconIco)) {
      candidates.push({ url: faviconIco, isApple: false, dim: 0 });
    }
  } catch {}

  // Deduplicate
  const seen = new Set();
  return candidates.filter(c => {
    if (seen.has(c.url)) return false;
    seen.add(c.url);
    return true;
  });
}

// Minimal magic-byte sniffing
function sniffImageType(bytes) {
  if (!bytes || bytes.length < 4) return null;
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png";
  if (bytes[0] === 0xFF && bytes[1] === 0xD8) return "image/jpeg";
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return "image/gif";
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[8] === 0x57) return "image/webp";
  if (bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x01 && bytes[3] === 0x00) return "image/x-icon";
  const head = String.fromCharCode(...Array.from(bytes.slice(0, 64)));
  if (/<svg/i.test(head) || head.trimStart().startsWith("<?xml")) return "image/svg+xml";
  return null;
}

// Fetch a single URL and return { buffer, contentType } if it looks like an image, else null.
async function tryFetchIcon(url) {
  let res;
  try {
    res = await fetch(url, {
      headers: {
        "User-Agent": FETCH_UA,
        "Accept": "image/*,*/*;q=0.5",
      },
      signal: AbortSignal.timeout(5000),
      redirect: "follow",
    });
  } catch {
    return null; // network/timeout
  }

  if (!res.ok) return null;

  let buf;
  try { buf = await res.arrayBuffer(); } catch { return null; }
  if (!buf || buf.byteLength === 0) return null;

  const bytes = new Uint8Array(buf);
  const ct = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();

  // Accept any content-type that looks like an image, OR sniff the bytes directly.
  // We intentionally do NOT reject on unknown content-type — many servers are misconfigured.
  const sniffed = sniffImageType(bytes);
  const knownImageType = [
    "image/", "application/octet-stream",
  ].some(t => ct.startsWith(t));

  if (!sniffed && !knownImageType) {
    // One more check: if the URL path ends with a known image extension, trust it
    const path = url.split("?")[0].toLowerCase();
    const hasImageExt = /\.(ico|png|jpg|jpeg|gif|webp|svg|avif|bmp)$/.test(path);
    if (!hasImageExt) return null;
  }

  const finalCt = sniffed || (ct && ct !== "application/octet-stream" ? ct : "image/x-icon");
  return { buffer: buf, contentType: finalCt };
}

// Try each candidate in order, return the first that succeeds.
async function fetchBestIcon(candidates) {
  for (const c of candidates) {
    const result = await tryFetchIcon(c.url);
    if (result) return { ...result, url: c.url };
  }
  return null;
}

// ─── Plugin export ────────────────────────────────────────────────────────────

export default {
  name: "Shortcuts",
  description: "Configurable shortcut tiles on the home page, stored per-browser",
  trigger: "shortcuts",

  settingsSchema: [
    {
      key: "defaultShortcuts",
      label: "Default Shortcuts",
      type: "urllist",
      description:
        'Default shortcuts shown to browsers with no saved shortcuts yet. ' +
        'Format each entry as: Label|https://url|#color  (color is optional). ' +
        'Example: YouTube|https://youtube.com|#ff0000',
      placeholder: "YouTube|https://youtube.com|#ff0000",
    },
    {
      key: "showAddButton",
      label: "Show \"Add Shortcut\" button",
      type: "toggle",
      description: "When enabled, a \"+\" tile is shown at the end of the shortcut grid so users can add new shortcuts directly from the home page.",
    },
    {
      key: "openInNewTab",
      label: "Open shortcuts in new tab",
      type: "toggle",
      description: "When enabled, clicking a shortcut opens the URL in a new browser tab.",
    },
  ],

  configure(settings) {
    const parsed = parseShortcutList(settings.defaultShortcuts);
    defaultShortcuts = parsed || [];
  },

  async execute() {
    return {
      title: "Shortcuts",
      html: `<div class="command-result"><p>The Shortcuts plugin adds bookmark tiles to the home page. Manage your shortcuts directly on the home page.</p></div>`,
    };
  },
};

// ─── Plugin Routes ────────────────────────────────────────────────────────────

export const routes = [
  {
    method: "get",
    path: "/defaults",
    handler: async () => {
      return new Response(JSON.stringify(defaultShortcuts), {
        headers: { "Content-Type": "application/json" },
      });
    },
  },

  {
    // GET /api/plugin/shortcuts/site-info?url=https://...
    // Returns { title, faviconUrl } where faviconUrl is the best icon URL found,
    // already verified to be fetchable from this server.
    method: "get",
    path: "/site-info",
    handler: async (req) => {
      const reqUrl = new URL(req.url);
      const target = reqUrl.searchParams.get("url");
      if (!target) {
        return new Response(JSON.stringify({ error: "Missing url" }), {
          status: 400, headers: { "Content-Type": "application/json" },
        });
      }

      let pageUrl;
      try {
        pageUrl = new URL(target);
        if (!["http:", "https:"].includes(pageUrl.protocol)) throw new Error();
      } catch {
        return new Response(JSON.stringify({ error: "Invalid URL" }), {
          status: 400, headers: { "Content-Type": "application/json" },
        });
      }

      let html = "";
      try {
        const res = await fetch(pageUrl.href, {
          headers: { "User-Agent": FETCH_UA, "Accept": "text/html" },
          signal: AbortSignal.timeout(6000),
          redirect: "follow",
        });
        if (res.ok) {
          const reader = res.body.getReader();
          let bytesRead = 0;
          while (bytesRead < 16384) {
            const { value, done } = await reader.read();
            if (done) break;
            if (value) { html += new TextDecoder().decode(value); bytesRead += value.byteLength; }
          }
          reader.cancel().catch(() => {});
        }
      } catch {}

      const titleMatch = html.match(/<title[^>]*>([^<]{1,200})<\/title>/i);
      const title = titleMatch ? decodeEntities(titleMatch[1].trim()) : null;

      // Extract icon candidates from the HTML, then verify each one server-side.
      // We return the raw URL of the first working icon so the client can request
      // it through /icon — no double-encoding, no broken proxy chains.
      const candidates = html ? extractIconCandidates(html, pageUrl.href)
        : [{ url: pageUrl.origin + "/favicon.ico" }];

      const best = await fetchBestIcon(candidates);
      const faviconUrl = best ? best.url : null;

      return new Response(JSON.stringify({ title, faviconUrl }), {
        headers: { "Content-Type": "application/json" },
      });
    },
  },

  {
    // GET /api/plugin/shortcuts/icon?url=https://...
    // Fetches the given icon URL server-side and pipes it to the browser.
    // Bypasses the core proxy's strict content-type allowlist entirely.
    method: "get",
    path: "/icon",
    handler: async (req) => {
      const url = new URL(req.url).searchParams.get("url");
      if (!url) return new Response("Missing url", { status: 400 });

      let parsed;
      try {
        parsed = new URL(url);
        if (!["http:", "https:"].includes(parsed.protocol)) throw new Error();
      } catch {
        return new Response("Invalid URL", { status: 400 });
      }

      const result = await tryFetchIcon(parsed.href);
      if (!result) return new Response("Icon not found", { status: 404 });

      return new Response(result.buffer, {
        status: 200,
        headers: {
          "Content-Type": result.contentType,
          "Cache-Control": "public, max-age=604800",
          "X-Content-Type-Options": "nosniff",
        },
      });
    },
  },
];
