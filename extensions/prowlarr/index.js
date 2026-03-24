export default {
  name: "Prowlarr",

  // 👇 This defines GUI settings
  settings: [
    {
      key: "baseUrl",
      type: "text",
      label: "Prowlarr URL",
      placeholder: "http://localhost:9696",
      default: "http://localhost:9696"
    },
    {
      key: "apiKey",
      type: "password",
      label: "API Key",
      placeholder: "Your Prowlarr API key"
    }
  ],

  async search(query, settings) {
    if (!settings.baseUrl || !settings.apiKey) {
      return [{
        title: "Prowlarr not configured",
        url: "#",
        description: "Please set URL and API key in settings"
      }];
    }

    try {
      const res = await fetch(
        `${settings.baseUrl}/api/v1/search?query=${encodeURIComponent(query)}&type=search`,
        {
          headers: {
            "X-Api-Key": settings.apiKey
          }
        }
      );

      if (!res.ok) {
        throw new Error("API error");
      }

      const data = await res.json();

      return data.map(item => ({
        title: item.title,
        url: item.guid || item.downloadUrl,
        description: formatDescription(item)
      }));

    } catch (err) {
      return [{
        title: "Prowlarr error",
        url: "#",
        description: err.message
      }];
    }
  }
};


// 👇 helper function (optional but nice)
function formatDescription(item) {
  const sizeMB = item.size
    ? (item.size / (1024 * 1024)).toFixed(2) + " MB"
    : "Unknown size";

  return `${item.indexer} • ${sizeMB}`;
}