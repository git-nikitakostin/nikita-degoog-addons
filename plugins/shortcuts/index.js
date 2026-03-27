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
    // Format: "Label|https://url|#color" or "Label|https://url"
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

const FETCH_HEADERS = {
  "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
};

// Content-types we accept as icons (much broader than the core proxy)
const IMAGE_CONTENT_TYPES = [
  "image/x-icon",
  "image/vnd.microsoft.icon",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "image/avif",
  "image/bmp",
  // Some servers return this for .ico
  "application/octet-stream",
];

function isImageContentType(ct) {
  if (!ct) return false;
  const lower = ct.split(";")[0].trim().toLowerCase();
  return IMAGE_CONTENT_TYPES.some(t => lower.startsWith(t));
}

function decodeEntities(str) {
  return str
    .replace(/&amp;/g,  "&")
    .replace(/&lt;/g,   "<")
    .replace(/&gt;/g,   ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'");
}

// Resolve a relative icon href against the page's origin
function resolveUrl(href, pageUrl) {
  if (!href) return null;
  href = href.trim();
  try {
    // new URL handles absolute, protocol-relative, and relative paths
    return new URL(href, pageUrl).href;
  } catch {
    return null;
  }
}

// Extract icon candidates from HTML, ordered best-first:
// apple-touch-icon (largest) > icon/shortcut icon (largest) > /favicon.ico
function extractIconCandidates(html, pageUrl) {
  const linkRe  = /<link([^>]+?)(?:\/>|>)/gi;
  const relRe   = /\brel\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i;
  const hrefRe  = /\bhref\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i;
  const sizesRe = /\bsizes\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i;

  const candidates = [];
  let m;
  while ((m = linkRe.exec(html)) !== null) {
    const attrs     = m[1];
    const relMatch  = relRe.exec(attrs);
    const hrefMatch = hrefRe.exec(attrs);
    if (!relMatch || !hrefMatch) continue;

    const rel  = (relMatch[1] || relMatch[2] || relMatch[3] || "").toLowerCase();
    const href = hrefMatch[1] || hrefMatch[2] || hrefMatch[3] || "";
    if (!rel.includes("icon") || !href) continue;

    const sizesMatch = sizesRe.exec(attrs);
    const sizes = sizesMatch ? (sizesMatch[1] || sizesMatch[2] || sizesMatch[3] || "") : "";
    const isApple = rel.includes("apple-touch-icon");
    // Parse the largest pixel dimension from sizes string (e.g. "32x32 64x64" → 64)
    const dim = sizes
      ? Math.max(0, ...sizes.trim().split(/\s+/).map(s => parseInt(s) || 0))
      : 0;

    const resolved = resolveUrl(href, pageUrl);
    if (resolved) candidates.push({ url: resolved, isApple, dim });
  }

  // Sort: apple-touch-icon first, then by declared size descending
  candidates.sort((a, b) => {
    if (a.isApple !== b.isApple) return a.isApple ? -1 : 1;
    return b.dim - a.dim;
  });

  // Always append /favicon.ico as last resort
  try {
    const origin = new URL(pageUrl).origin;
    candidates.push({ url: origin + "/favicon.ico", isApple: false, dim: 0 });
  } catch {}

  // Deduplicate by URL
  const seen = new Set();
  return candidates.filter(c => {
    if (seen.has(c.url)) return false;
    seen.add(c.url);
    return true;
  });
}

// Try fetching each candidate URL in order; return { url, buffer, contentType }
// for the first one that responds with actual image bytes, or null.
async function fetchFirstWorkingIcon(candidates) {
  for (const candidate of candidates) {
    try {
      const res = await fetch(candidate.url, {
        headers: { ...FETCH_HEADERS, Accept: "image/*,*/*;q=0.8" },
        signal: AbortSignal.timeout(4000),
        redirect: "follow",
      });
      if (!res.ok) continue;

      const ct = res.headers.get("content-type") || "";

      // Check content-type — but also accept unknown for .ico/.png paths
      const urlLower = candidate.url.toLowerCase().split("?")[0];
      const looksLikeImage = /\.(ico|png|jpg|jpeg|gif|webp|svg|avif|bmp)$/.test(urlLower);

      if (!isImageContentType(ct) && !looksLikeImage) continue;

      const buf = await res.arrayBuffer();
      if (buf.byteLength === 0) continue;

      // Detect real content type from magic bytes if server didn't tell us
      let finalCt = ct.split(";")[0].trim() || "image/x-icon";
      if (!isImageContentType(finalCt) || finalCt === "application/octet-stream") {
        finalCt = sniffImageType(new Uint8Array(buf)) || finalCt;
      }

      return { url: candidate.url, buffer: buf, contentType: finalCt };
    } catch {
      // timeout / network error — try next candidate
    }
  }
  return null;
}

// Minimal magic-byte sniffing for common image formats
function sniffImageType(bytes) {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png";
  if (bytes[0] === 0xFF && bytes[1] === 0xD8) return "image/jpeg";
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return "image/gif";
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[8] === 0x57) return "image/webp";
  if (bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x01 && bytes[3] === 0x00) return "image/x-icon";
  // SVG starts with "<svg" or "<?xml" or "<!" (after possible BOM/whitespace)
  const head = String.fromCharCode(...bytes.slice(0, 32));
  if (/<svg/i.test(head) || /^<\?xml/i.test(head.trimStart())) return "image/svg+xml";
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
      html: `<div class="command-result"><p>The Shortcuts plugin adds bookmark tiles to the home page. No search command is provided — manage your shortcuts directly on the home page.</p></div>`,
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
    // Fetches the page server-side, returns { title, iconCandidates[] }
    // iconCandidates is an ordered list of icon URLs to try (best first).
    method: "get",
    path: "/site-info",
    handler: async (req) => {
      const reqUrl = new URL(req.url);
      const target = reqUrl.searchParams.get("url");
      if (!target) {
        return new Response(JSON.stringify({ error: "Missing url param" }), {
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

      try {
        const res = await fetch(pageUrl.href, {
          headers: FETCH_HEADERS,
          signal: AbortSignal.timeout(6000),
          redirect: "follow",
        });

        if (!res.ok) {
          // Page unreachable but we can still try /favicon.ico
          const origin = pageUrl.origin;
          return new Response(JSON.stringify({
            title: null,
            iconCandidates: [origin + "/favicon.ico"],
          }), { headers: { "Content-Type": "application/json" } });
        }

        // Read first 16 KB — enough for <head>
        const reader = res.body.getReader();
        let html = "";
        let bytesRead = 0;
        while (bytesRead < 16384) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) { html += new TextDecoder().decode(value); bytesRead += value.byteLength; }
        }
        reader.cancel().catch(() => {});

        const titleMatch = html.match(/<title[^>]*>([^<]{1,200})<\/title>/i);
        const title = titleMatch ? decodeEntities(titleMatch[1].trim()) : null;

        const candidates = extractIconCandidates(html, pageUrl.href);
        const iconCandidates = candidates.map(c => c.url);

        return new Response(JSON.stringify({ title, iconCandidates }), {
          headers: { "Content-Type": "application/json" },
        });
      } catch {
        return new Response(JSON.stringify({ title: null, iconCandidates: [] }), {
          headers: { "Content-Type": "application/json" },
        });
      }
    },
  },

  {
    // GET /api/plugin/shortcuts/icon?url=https://...
    // Tries the given URL (and falls back through candidates list via ?candidates=url1,url2)
    // Fetches server-side and streams the image bytes back to the browser.
    // This completely bypasses the core /api/proxy/image restrictions.
    method: "get",
    path: "/icon",
    handler: async (req) => {
      const reqUrl = new URL(req.url);
      const primaryUrl = reqUrl.searchParams.get("url");
      const extraRaw   = reqUrl.searchParams.get("candidates") || "";

      if (!primaryUrl) {
        return new Response("Missing url", { status: 400 });
      }

      // Build candidate list: primary first, then any extras
      const extras = extraRaw ? extraRaw.split(",").map(s => s.trim()).filter(Boolean) : [];
      const allCandidates = [primaryUrl, ...extras]
        .map(u => { try { return new URL(u).href; } catch { return null; } })
        .filter(Boolean)
        .filter(u => /^https?:\/\//i.test(u));

      if (allCandidates.length === 0) {
        return new Response("Invalid URL", { status: 400 });
      }

      const candidates = allCandidates.map(u => ({ url: u, isApple: false, dim: 0 }));
      const result = await fetchFirstWorkingIcon(candidates);

      if (!result) {
        return new Response("Icon not found", { status: 404 });
      }

      return new Response(result.buffer, {
        status: 200,
        headers: {
          "Content-Type": result.contentType,
          "Cache-Control": "public, max-age=604800", // 1 week
          "X-Content-Type-Options": "nosniff",
        },
      });
    },
  },
];
