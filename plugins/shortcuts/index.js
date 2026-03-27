/**
 * Shortcuts Plugin
 * Adds a configurable shortcuts grid to the degoog home page.
 * Shortcuts are stored in the browser's localStorage (per-browser/user).
 * Server-side settings define the default shortcuts that are used when
 * a browser has no locally stored shortcuts yet.
 */

const DEFAULT_SHORTCUTS = [
  { id: "yt",  label: "YouTube",  url: "https://youtube.com",  color: "#ff0000" },
  { id: "gh",  label: "GitHub",   url: "https://github.com",   color: "#333333" },
  { id: "rd",  label: "Reddit",   url: "https://reddit.com",   color: "#ff4500" },
  { id: "tw",  label: "Twitter",  url: "https://x.com",        color: "#1da1f2" },
  { id: "wp",  label: "Wikipedia",url: "https://wikipedia.org",color: "#636466" },
  { id: "gm",  label: "Gmail",    url: "https://gmail.com",    color: "#ea4335" },
];

/** Current defaults from settings (may be overridden by configure()) */
let defaultShortcuts = DEFAULT_SHORTCUTS.slice();

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
    defaultShortcuts = parsed || DEFAULT_SHORTCUTS.slice();
  },

  async execute() {
    return {
      title: "Shortcuts",
      html: `<div class="command-result"><p>The Shortcuts plugin adds bookmark tiles to the home page. No search command is provided — manage your shortcuts directly on the home page.</p></div>`,
    };
  },
};

// ─── Plugin Routes ────────────────────────────────────────────────────────────
// These routes let the client-side script fetch the server-configured defaults.

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
];
