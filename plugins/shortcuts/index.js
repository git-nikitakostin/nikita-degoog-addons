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
    // Fetches the <title> and favicon of a remote URL server-side (bypasses CORS/private networks).
    // ?url=https://example.com
    method: "get",
    path: "/site-info",
    handler: async (req) => {
      const reqUrl = new URL(req.url);
      const target = reqUrl.searchParams.get("url");

      if (!target) {
        return new Response(JSON.stringify({ error: "Missing url param" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      let parsedUrl;
      try {
        parsedUrl = new URL(target);
        if (!["http:", "https:"].includes(parsedUrl.protocol)) throw new Error("Bad protocol");
      } catch {
        return new Response(JSON.stringify({ error: "Invalid URL" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      const origin = parsedUrl.origin; // e.g. "http://192.168.1.10:8096"

      function decodeEntities(str) {
        return str
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"')
          .replace(/&#039;/g, "'")
          .replace(/&apos;/g, "'");
      }

      // Resolve a potentially relative icon href against the page origin
      function resolveIconUrl(href) {
        if (!href) return null;
        href = href.trim();
        if (/^https?:\/\//i.test(href)) return href;
        if (href.startsWith("//")) return parsedUrl.protocol + href;
        if (href.startsWith("/")) return origin + href;
        return origin + "/" + href;
      }

      // Extract the best icon from <link> tags in the HTML chunk.
      // Priority: apple-touch-icon > shortcut icon / icon with largest size > /favicon.ico fallback
      function extractIconUrl(html) {
        const linkRe = /<link([^>]+)>/gi;
        const relRe  = /rel\s*=\s*["']([^"']+)["']/i;
        const hrefRe = /href\s*=\s*["']([^"']+)["']/i;
        const sizesRe= /sizes\s*=\s*["']([^"']+)["']/i;

        const candidates = [];
        let m;
        while ((m = linkRe.exec(html)) !== null) {
          const attrs = m[1];
          const relMatch  = relRe.exec(attrs);
          const hrefMatch = hrefRe.exec(attrs);
          if (!relMatch || !hrefMatch) continue;
          const rel  = relMatch[1].toLowerCase();
          const href = hrefMatch[1];
          if (!rel.includes("icon")) continue;
          const sizesMatch = sizesRe.exec(attrs);
          const sizes = sizesMatch ? sizesMatch[1] : "";
          const isApple = rel.includes("apple-touch-icon");
          // Parse largest dimension from sizes (e.g. "32x32" → 32)
          const dim = sizes ? Math.max(...sizes.split(/\s+/).map(s => parseInt(s) || 0)) : 0;
          candidates.push({ href, isApple, dim });
        }

        if (candidates.length === 0) return null;

        // Sort: apple-touch-icon first, then by size descending
        candidates.sort((a, b) => {
          if (a.isApple !== b.isApple) return a.isApple ? -1 : 1;
          return b.dim - a.dim;
        });

        return resolveIconUrl(candidates[0].href);
      }

      try {
        const res = await fetch(parsedUrl.href, {
          headers: { "User-Agent": "Mozilla/5.0 (compatible; degoog-shortcuts/1.0)" },
          signal: AbortSignal.timeout(6000),
          redirect: "follow",
        });

        if (!res.ok) {
          return new Response(JSON.stringify({ title: null, faviconUrl: null }), {
            headers: { "Content-Type": "application/json" },
          });
        }

        // Read only the first 16 KB — enough to find <title> and <link> icon tags in <head>
        const reader = res.body.getReader();
        let chunk = "";
        let bytesRead = 0;
        const MAX_BYTES = 16384;

        while (bytesRead < MAX_BYTES) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) {
            chunk += new TextDecoder().decode(value);
            bytesRead += value.byteLength;
          }
        }
        reader.cancel().catch(() => {});

        // Extract title
        const titleMatch = chunk.match(/<title[^>]*>([^<]{1,200})<\/title>/i);
        const title = titleMatch ? decodeEntities(titleMatch[1].trim()) : null;

        // Extract favicon from <link> tags; fall back to /favicon.ico
        let faviconUrl = extractIconUrl(chunk);
        if (!faviconUrl) {
          faviconUrl = origin + "/favicon.ico";
        }

        return new Response(JSON.stringify({ title, faviconUrl }), {
          headers: { "Content-Type": "application/json" },
        });
      } catch {
        return new Response(JSON.stringify({ title: null, faviconUrl: null }), {
          headers: { "Content-Type": "application/json" },
        });
      }
    },
  },
];
