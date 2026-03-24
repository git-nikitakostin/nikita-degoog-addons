# Prowlarr Engine for degoog

Search all your configured [Prowlarr](https://prowlarr.com) indexers directly from [degoog](https://github.com/fccview/degoog).  
Results appear under a dedicated **Torrents** tab alongside the regular Web results.

## Install via Store

1. Open degoog **Settings → Store**
2. Click **Add repo** and paste your clone URL (e.g. `https://github.com/you/prowlarr-degoog-engine.git`)
3. Find **Prowlarr** in the Store and install it
4. Go to **Settings → Engines → Prowlarr → Configure** and fill in:
   - **Prowlarr URL** — e.g. `http://localhost:9696`
   - **API Key** — from Prowlarr → Settings → General → Security
   - **Category IDs** *(optional)* — e.g. `2000,5000` for Movies + TV
   - **Max results** — 25, 50, or 100

## Manual install

Copy `engines/prowlarr/` into your `data/engines/` directory and restart degoog.

## Usage

- A **Torrents** tab appears in search results when the engine is enabled and configured
- Bang shortcut: `!prowlarr search term` to search Prowlarr directly

## Common category IDs

| ID | Category |
|----|----------|
| 2000 | Movies |
| 5000 | TV |
| 3000 | Audio / Music |
| 4000 | PC / Software |
| 7000 | Books |
| 8000 | Other |
