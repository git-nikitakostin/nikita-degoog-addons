# Prowlarr Plugin for degoog

Search all your configured [Prowlarr](https://prowlarr.com) indexers directly from [degoog](https://github.com/fccview/degoog) using `!prowlarr`.

## Install via Store

1. Open degoog **Settings → Store**
2. Click **Add repo** and paste your clone URL
3. Find **Prowlarr** in the Store and install it
4. Go to **Settings → Plugins → Prowlarr → Configure** and fill in:
   - **Prowlarr URL** — e.g. `http://localhost:9696`
   - **API Key** — from Prowlarr → Settings → General → Security
   - **Category IDs** *(optional)* — e.g. `2000,5000` for Movies + TV
   - **Max results** — 25, 50, or 100

## Usage

```
!prowlarr ubuntu 22.04
!pw the dark knight
```

## Common category IDs

| ID | Category |
|----|----------|
| 2000 | Movies |
| 5000 | TV |
| 3000 | Audio / Music |
| 4000 | PC / Software |
| 7000 | Books |
| 8000 | Other |
