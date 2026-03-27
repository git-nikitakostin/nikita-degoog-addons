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
    // Fetches the <title> of a remote URL so the client can auto-fill the name field.
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

      try {
        const res = await fetch(parsedUrl.href, {
          headers: { "User-Agent": "Mozilla/5.0 (compatible; degoog-shortcuts/1.0)" },
          signal: AbortSignal.timeout(6000),
          redirect: "follow",
        });

        if (!res.ok) {
          return new Response(JSON.stringify({ title: null }), {
            headers: { "Content-Type": "application/json" },
          });
        }

        // Read only the first 16 KB — enough to find <title>
        const reader = res.body.getReader();
        let chunk = "";
        let done = false;
        let bytesRead = 0;
        const MAX_BYTES = 16384;

        while (!done && bytesRead < MAX_BYTES) {
          const { value, done: d } = await reader.read();
          done = d;
          if (value) {
            chunk += new TextDecoder().decode(value);
            bytesRead += value.byteLength;
          }
        }
        reader.cancel().catch(() => {});

        const titleMatch = chunk.match(/<title[^>]*>([^<]{1,200})<\/title>/i);
        const rawTitle = titleMatch ? titleMatch[1].trim() : null;

        // Decode common HTML entities
        const title = rawTitle
          ? rawTitle
              .replace(/&amp;/g, "&")
              .replace(/&lt;/g, "<")
              .replace(/&gt;/g, ">")
              .replace(/&quot;/g, '"')
              .replace(/&#039;/g, "'")
              .replace(/&apos;/g, "'")
          : null;

        return new Response(JSON.stringify({ title }), {
          headers: { "Content-Type": "application/json" },
        });
      } catch {
        return new Response(JSON.stringify({ title: null }), {
          headers: { "Content-Type": "application/json" },
        });
      }
    },
  },
];
