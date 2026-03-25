const PROWLARR_LOGO =
  "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@refs/heads/main/svg/prowlarr.svg";

const TRACKERS = [
  "udp://open.stealth.si:80/announce",
  "udp://tracker.opentrackr.org:1337/announce",
  "udp://tracker.torrent.eu.org:451/announce",
  "udp://tracker.tiny-vps.com:6969/announce",
  "http://nyaa.tracker.wf:7777/announce",
].map((t) => `&tr=${encodeURIComponent(t)}`).join("");

const SORT_OPTIONS = {
  "Default":      { fn: null },
  "Seeders":      { fn: (a, b) => (b.seeders ?? -1) - (a.seeders ?? -1) },
  "Leechers":     { fn: (a, b) => (b.leechers ?? -1) - (a.leechers ?? -1) },
  "Size (asc)":   { fn: (a, b) => (a.size ?? 0) - (b.size ?? 0) },
  "Size (desc)":  { fn: (a, b) => (b.size ?? 0) - (a.size ?? 0) },
  "Newest first": { fn: (a, b) => new Date(b.publishDate ?? 0) - new Date(a.publishDate ?? 0) },
};

let prowlarrUrl = "";
let apiKey = "";
let categories = [];
let defaultSort = "Default";
let template = "";

// ─── Bencode parser (no deps) ─────────────────────────────────────────────────

function bencodeSkip(buf, i) {
  if (i >= buf.length) return -1;
  const c = buf[i];
  if (c === 100) { // 'd'
    i++;
    while (i < buf.length && buf[i] !== 101) {
      i = bencodeSkip(buf, i); if (i === -1) return -1;
      i = bencodeSkip(buf, i); if (i === -1) return -1;
    }
    return i + 1;
  }
  if (c === 108) { // 'l'
    i++;
    while (i < buf.length && buf[i] !== 101) {
      i = bencodeSkip(buf, i); if (i === -1) return -1;
    }
    return i + 1;
  }
  if (c === 105) { // 'i'
    const e = buf.indexOf(101, i + 1);
    return e === -1 ? -1 : e + 1;
  }
  if (c >= 48 && c <= 57) { // string "len:data"
    const colon = buf.indexOf(58, i);
    if (colon === -1) return -1;
    const len = parseInt(buf.slice(i, colon).toString(), 10);
    return colon + 1 + len;
  }
  return -1;
}

async function extractInfoHash(buf) {
  const marker = Buffer.from("4:info");
  const idx = buf.indexOf(marker);
  if (idx === -1) return null;
  const start = idx + marker.length;
  const end = bencodeSkip(buf, start);
  if (end === -1) return null;
  const { createHash } = await import("node:crypto");
  return createHash("sha1").update(buf.slice(start, end)).digest("hex");
}

async function torrentToMagnet(downloadUrl, title, doFetch) {
  try {
    const res = await doFetch(downloadUrl, { redirect: "follow" });
    if (!res.ok) return null;
    const arrayBuf = await res.arrayBuffer();
    const buf = Buffer.from(arrayBuf);
    const hash = await extractInfoHash(buf);
    if (!hash) return null;
    const dn = encodeURIComponent(title ?? "");
    return `magnet:?xt=urn:btih:${hash}&dn=${dn}${TRACKERS}`;
  } catch {
    return null;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

function renderItem(item, resolvedMagnet) {
  const magnetUrl = resolvedMagnet || item.magnetUrl || null;
  const downloadUrl = item.downloadUrl || null;
  const infoUrl = item.infoUrl || item.guid || null;

  const titleUrl = infoUrl ?? magnetUrl ?? downloadUrl ?? "#";

  const magnetBtn = magnetUrl
    ? `<a class="prowlarr-btn prowlarr-btn-magnet" href="${escHtml(magnetUrl)}">\uD83E\uDDF2 Magnet</a>`
    : "";
  const torrentBtn = downloadUrl
    ? `<a class="prowlarr-btn prowlarr-btn-torrent" href="${escHtml(downloadUrl)}">\u2B07 Torrent</a>`
    : "";
  const actionButtons = (magnetBtn || torrentBtn)
    ? `<div class="prowlarr-actions">${magnetBtn}${torrentBtn}</div>`
    : "";

  const parts = [];
  if (item.categoryDesc || item.category)
    parts.push(item.categoryDesc ?? item.category);
  if (typeof item.size === "number" && item.size > 0)
    parts.push(formatBytes(item.size));
  if (typeof item.seeders === "number")
    parts.push(`\u2191 ${item.seeders} seeders`);
  if (typeof item.leechers === "number")
    parts.push(`\u2193 ${item.leechers} leechers`);
  if (item.publishDate)
    parts.push(new Date(item.publishDate).toLocaleDateString());

  const badges = [
    item.indexer
      ? `<span class="result-engine-tag">${escHtml(item.indexer)}</span>`
      : "",
    item.categoryDesc || item.category
      ? `<span class="result-engine-tag">${escHtml(item.categoryDesc ?? item.category)}</span>`
      : "",
  ].filter(Boolean).join("");

  const data = {
    faviconSrc: PROWLARR_LOGO,
    cite: escHtml(item.indexer ?? prowlarrUrl),
    titleUrl: escHtml(titleUrl),
    title: escHtml(item.title ?? "(no title)"),
    actionButtons,
    snippet: escHtml(parts.join(" \u00b7 ") || ""),
    badges,
    thumbBlock: "",
  };

  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => data[key] ?? "");
}

// ─── Plugin export ────────────────────────────────────────────────────────────

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
      description: "Found under Prowlarr \u2192 Settings \u2192 General \u2192 Security.",
    },
    {
      key: "categories",
      label: "Category IDs (optional)",
      type: "text",
      placeholder: "2000,5000",
      description:
        "Comma-separated Newznab category IDs to filter results. Leave blank to search all. Common: 2000 Movies, 5000 TV, 3000 Audio, 4000 PC, 7000 Books.",
    },
    {
      key: "defaultSort",
      label: "Default sort",
      type: "select",
      options: Object.keys(SORT_OPTIONS),
      description: "How to sort results. You can override per-search with !prowlarr term --sort seeders",
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
    defaultSort = SORT_OPTIONS[settings.defaultSort] ? settings.defaultSort : "Default";
  },

  async isConfigured() {
    return true;
  },

  async execute(args, context) {
    if (!prowlarrUrl || !apiKey) {
      return {
        title: "Prowlarr",
        html: `<div class="command-result"><p>Prowlarr is not configured. Go to <a href="/settings">Settings \u2192 Plugins</a> to set your Prowlarr URL and API key.</p></div>`,
      };
    }

    if (!args.trim()) {
      return {
        title: "Prowlarr",
        html: `<div class="command-result"><p>Usage: <code>!prowlarr &lt;search term&gt;</code> <br>Optional: <code>--sort seeders|leechers|size_asc|size_desc|date</code></p></div>`,
      };
    }

    // Parse optional --sort flag from args
    const sortMatch = args.match(/--sort\s+(\S+)/);
    const sortKey = (sortMatch && SORT_OPTIONS[sortMatch[1]]) ? sortMatch[1] : defaultSort;
    const term = args.replace(/--sort\s+\S+/, "").trim();

    try {
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

      const doFetch = context?.fetch ?? fetch;

      const res = await doFetch(
        `${prowlarrUrl}/api/v1/search?${params.toString()}`,
        { headers: { "X-Api-Key": apiKey, Accept: "application/json" } }
      );

      if (!res.ok) {
        return {
          title: "Prowlarr",
          html: `<div class="command-result"><p>Prowlarr returned an error: ${escHtml(res.status + " " + res.statusText)}</p></div>`,
        };
      }

      let data = await res.json();
      if (!Array.isArray(data) || data.length === 0) {
        return {
          title: "Prowlarr",
          html: `<div class="command-result"><p>No results found for "${escHtml(term)}"</p></div>`,
        };
      }

      // Sort
      const sortFn = SORT_OPTIONS[sortKey]?.fn;
      if (sortFn) data = [...data].sort(sortFn);

      // Resolve magnets for items that only have a .torrent download URL
      const resolved = await Promise.all(
        data.map(async (item) => {
          if (item.magnetUrl || !item.downloadUrl) return null;
          return torrentToMagnet(item.downloadUrl, item.title, doFetch);
        })
      );

      const sortLabel = sortKey !== "Default" ? ` \u2022 sorted by ${sortKey}` : "";
      const results = data.map((item, i) => renderItem(item, resolved[i])).join("");

      return {
        title: `Prowlarr: ${term} \u2014 ${data.length} results${sortLabel}`,
        html: `<div class="command-result">${results}</div>`,
      };
    } catch {
      return {
        title: "Prowlarr",
        html: `<div class="command-result"><p>Failed to connect to Prowlarr. Check your configuration in <a href="/settings">Settings \u2192 Plugins</a>.</p></div>`,
      };
    }
  },
};
