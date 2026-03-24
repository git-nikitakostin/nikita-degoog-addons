export const outgoingHosts = ["*"];

export default class ProwlarrEngine {
  name = "Prowlarr";
  bangShortcut = "prowlarr";

  _url = "";
  _apiKey = "";
  _categories = [];
  _limit = 100;

  settingsSchema = [
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
      placeholder: "2000,5000",
      description:
        "Comma-separated Newznab category IDs to filter results. Leave blank to search all. Common: 2000 Movies, 5000 TV, 3000 Audio, 4000 PC, 7000 Books.",
    },
    {
      key: "limit",
      label: "Max results",
      type: "select",
      options: ["25", "50", "100"],
      description: "Maximum number of results returned per query.",
    },
  ];

  configure(settings) {
    this._url = (settings.url || "").replace(/\/$/, "");
    this._apiKey = settings.apiKey || "";
    this._categories = settings.categories
      ? settings.categories
          .split(",")
          .map((c) => parseInt(c.trim(), 10))
          .filter((n) => !isNaN(n))
      : [];
    this._limit = parseInt(settings.limit, 10) || 100;
  }

  isConfigured() {
    return Boolean(this._url && this._apiKey);
  }

  async executeSearch(query, page = 1, _timeFilter, context) {
    if (!this._url || !this._apiKey) return [];

    const doFetch = context?.fetch ?? fetch;
    const offset = this._limit * (page - 1);

    const params = new URLSearchParams({
      query,
      type: "search",
      limit: String(this._limit),
      offset: String(offset),
      apikey: this._apiKey,
    });

    if (this._categories.length > 0) {
      for (const cat of this._categories) {
        params.append("categories", String(cat));
      }
    }

    const endpoint = `${this._url}/api/v1/search?${params.toString()}`;

    let data;
    try {
      const res = await doFetch(endpoint, {
        headers: {
          "X-Api-Key": this._apiKey,
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
        parts.push(`Size: ${_formatBytes(item.size)}`);
      if (typeof item.seeders === "number")
        parts.push(`↑ ${item.seeders} seeders`);
      if (typeof item.leechers === "number")
        parts.push(`↓ ${item.leechers} leechers`);
      if (item.publishDate)
        parts.push(`Published: ${new Date(item.publishDate).toLocaleDateString()}`);

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

function _formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}
