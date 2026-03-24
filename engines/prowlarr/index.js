/**
 * Prowlarr Search Engine for degoog
 *
 * Searches all configured Prowlarr indexers via the /api/v1/search endpoint.
 * Results appear under a dedicated "Torrents" tab on the search results page.
 *
 * Settings:
 *   url        — Prowlarr base URL (e.g. http://localhost:9696)
 *   apiKey     — Prowlarr API key (Settings → General → Security → API Key)
 *   categories — Optional comma-separated Newznab category IDs (e.g. "2000,5000")
 *   limit      — Max results per page (25 / 50 / 100)
 */

export const type = "torrents";

// User-defined host, so allow any outgoing hostname
export const outgoingHosts = ["*"];

export const settingsSchema = [
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
    required: true,
    secret: true,
    placeholder: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    description: "Found under Prowlarr → Settings → General → Security.",
  },
  {
    key: "categories",
    label: "Category IDs (optional)",
    type: "text",
    required: false,
    placeholder: "2000,5000,8000",
    description:
      "Comma-separated Newznab category IDs to filter results. Leave blank to search all categories. Common: 2000 Movies, 5000 TV, 3000 Audio, 4000 PC, 7000 Books.",
  },
  {
    key: "limit",
    label: "Max results",
    type: "select",
    options: ["25", "50", "100"],
    description: "Maximum number of results returned per query.",
  },
];

let _url = "";
let _apiKey = "";
let _categories = [];
let _limit = 100;

export function configure(settings) {
  _url = (settings.url || "").replace(/\/$/, "");
  _apiKey = settings.apiKey || "";
  _categories = settings.categories
    ? settings.categories
        .split(",")
        .map((c) => parseInt(c.trim(), 10))
        .filter((n) => !isNaN(n))
    : [];
  _limit = parseInt(settings.limit, 10) || 100;
}

export function isConfigured() {
  return Boolean(_url && _apiKey);
}

export default class ProwlarrEngine {
  name = "Prowlarr";
  bangShortcut = "prowlarr";

  async executeSearch(query, page = 1, _timeFilter, context) {
    if (!_url || !_apiKey) return [];

    const doFetch = context?.fetch ?? fetch;
    const offset = _limit * (page - 1);

    const params = new URLSearchParams({
      query,
      type: "search",
      limit: String(_limit),
      offset: String(offset),
      apikey: _apiKey,
    });

    if (_categories.length > 0) {
      for (const cat of _categories) {
        params.append("categories", String(cat));
      }
    }

    const endpoint = `${_url}/api/v1/search?${params.toString()}`;

    let data;
    try {
      const res = await doFetch(endpoint, {
        headers: {
          "X-Api-Key": _apiKey,
          Accept: "application/json",
        },
      });

      if (!res.ok) {
        console.error(`[prowlarr] API error ${res.status}: ${res.statusText}`);
        return [];
      }

      data = await res.json();
    } catch (err) {
      console.error("[prowlarr] Fetch failed:", err);
      return [];
    }

    if (!Array.isArray(data)) return [];

    return data.map((item) => {
      const magnetUrl = item.magnetUrl || null;
      const downloadUrl = item.downloadUrl || null;
      const infoUrl = item.infoUrl || item.guid || null;

      const parts = [];
      if (item.indexer) parts.push(`Indexer: ${item.indexer}`);
      if (item.categoryDesc || item.category)
        parts.push(`Category: ${item.categoryDesc ?? item.category}`);
      if (typeof item.size === "number")
        parts.push(`Size: ${formatBytes(item.size)}`);
      if (typeof item.seeders === "number")
        parts.push(`↑ ${item.seeders} seeders`);
      if (typeof item.leechers === "number")
        parts.push(`↓ ${item.leechers} leechers`);
      if (item.publishDate)
        parts.push(
          `Published: ${new Date(item.publishDate).toLocaleDateString()}`
        );

      // Prefer magnet → download URL → info page for the clickable link
      const resultUrl = magnetUrl ?? downloadUrl ?? infoUrl ?? "#";

      return {
        title: item.title ?? "(no title)",
        url: resultUrl,
        snippet: parts.join(" · ") || "No details available.",
        source: item.indexer ?? "Prowlarr",
      };
    });
  }
}

function formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}
