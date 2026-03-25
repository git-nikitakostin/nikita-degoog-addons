const PROWLARR_LOGO =
  "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@refs/heads/main/svg/prowlarr.svg";

let prowlarrUrl = "";
let apiKey = "";
let categories = [];
let template = "";

function escHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return "";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

function renderItem(item) {
  const magnetUrl = item.magnetUrl || null;
  const downloadUrl = item.downloadUrl || null;
  const infoUrl = item.infoUrl || item.guid || null;

  // Primary link: prefer magnet, fall back to .torrent download, then info page
  const primaryUrl = magnetUrl ?? downloadUrl ?? infoUrl ?? "#";
  const primaryLabel = magnetUrl ? "🧲 magnet" : downloadUrl ? "⬇ torrent" : null;

  // Secondary link: tracker info page (only show if we already have a magnet/download as primary)
  const trackerUrl = (magnetUrl || downloadUrl) ? infoUrl : null;

  const parts = [];
  if (item.categoryDesc || item.category)
    parts.push(item.categoryDesc ?? item.category);
  if (typeof item.size === "number" && item.size > 0)
    parts.push(formatBytes(item.size));
  if (typeof item.seeders === "number")
    parts.push(`↑ ${item.seeders} seeders`);
  if (typeof item.leechers === "number")
    parts.push(`↓ ${item.leechers} leechers`);
  if (item.publishDate)
    parts.push(new Date(item.publishDate).toLocaleDateString());

  const badges = [
    item.indexer
      ? `<span class="result-engine-tag">${escHtml(item.indexer)}</span>`
      : "",
    item.categoryDesc || item.category
      ? `<span class="result-engine-tag">${escHtml(item.categoryDesc ?? item.category)}</span>`
      : "",
  ]
    .filter(Boolean)
    .join("");

  const trackerLink = trackerUrl
    ? `<a class="prowlarr-tracker-link" href="${escHtml(trackerUrl)}">torrent page ↗</a>`
    : "";

  const data = {
    faviconSrc: PROWLARR_LOGO,
    cite: escHtml(item.indexer ?? prowlarrUrl),
    itemUrl: escHtml(primaryUrl),
    itemLabel: primaryLabel ? escHtml(primaryLabel) : escHtml(item.title ?? "(no title)"),
    title: escHtml(item.title ?? "(no title)"),
    snippet: escHtml(parts.join(" · ") || ""),
    badges,
    trackerLink,
    thumbBlock: "",
  };

  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => data[key] ?? "");
}

export default {
  name: "Prowlarr",
  description: "Search your Prowlarr indexers",
  trigger: "prowlarr",
  aliases: ["pw"],

  settingsSchema: [
    {
      key: "url",
      label: "Prowlarr URL",
      type: "url",
      required: true,
      placeholder: "http://localhost:9696",
      description: "Base URL of your Prowlarr instance (no trailing slash).",
    },
    {
      key: "apiKey",
      label: "API Key",
      type: "password",
      secret: true,
      required: true,
      placeholder: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      description: "Found under Prowlarr → Settings → General → Security.",
    },
    {
      key: "categories",
      label: "Category IDs (optional)",
      type: "text",
      placeholder: "2000,5000",
      description:
        "Comma-separated Newznab category IDs to filter results. Leave blank to search all. Common: 2000 Movies, 5000 TV, 3000 Audio, 4000 PC, 7000 Books.",
    },
  ],

  init(ctx) {
    template = ctx.template;
  },

  configure(settings) {
    prowlarrUrl = (settings.url || "").replace(/\/$/, "");
    apiKey = settings.apiKey || "";
    categories = settings.categories
      ? settings.categories
          .split(",")
          .map((c) => parseInt(c.trim(), 10))
          .filter((n) => !isNaN(n))
      : [];
  },

  async isConfigured() {
    return true;
  },

  async execute(args, context) {
    if (!prowlarrUrl || !apiKey) {
      return {
        title: "Prowlarr",
        html: `<div class="command-result"><p>Prowlarr is not configured. Go to <a href="/settings">Settings → Plugins</a> to set your Prowlarr URL and API key.</p></div>`,
      };
    }

    if (!args.trim()) {
      return {
        title: "Prowlarr",
        html: `<div class="command-result"><p>Usage: <code>!prowlarr &lt;search term&gt;</code></p></div>`,
      };
    }

    try {
      const term = args.trim();

      const params = new URLSearchParams({
        query: term,
        type: "search",
        limit: "100",
        offset: "0",
        apikey: apiKey,
      });

      if (categories.length > 0) {
        for (const cat of categories) {
          params.append("categories", String(cat));
        }
      }

      const res = await fetch(
        `${prowlarrUrl}/api/v1/search?${params.toString()}`,
        {
          headers: {
            "X-Api-Key": apiKey,
            Accept: "application/json",
          },
        }
      );

      if (!res.ok) {
        return {
          title: "Prowlarr",
          html: `<div class="command-result"><p>Prowlarr returned an error: ${escHtml(res.status + " " + res.statusText)}</p></div>`,
        };
      }

      const data = await res.json();

      if (!Array.isArray(data) || data.length === 0) {
        return {
          title: "Prowlarr",
          html: `<div class="command-result"><p>No results found for "${escHtml(term)}"</p></div>`,
        };
      }

      const results = data.map((item) => renderItem(item)).join("");

      return {
        title: `Prowlarr: ${term} — ${data.length} results`,
        html: `<div class="command-result">${results}</div>`,
      };
    } catch {
      return {
        title: "Prowlarr",
        html: `<div class="command-result"><p>Failed to connect to Prowlarr. Check your configuration in <a href="/settings">Settings → Plugins</a>.</p></div>`,
      };
    }
  },
};
