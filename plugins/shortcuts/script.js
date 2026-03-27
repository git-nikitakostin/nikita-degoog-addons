(function () {
  // Only inject on the home page (no search query)
  if (new URLSearchParams(window.location.search).get("q")) return;
  if (window.location.pathname !== "/") return;

  var STORAGE_KEY = "shortcuts-plugin-data";

  // ─── Storage (localStorage, per-browser) ─────────────────────────────────

  function loadShortcuts() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var data = JSON.parse(raw);
        if (Array.isArray(data.shortcuts)) return data;
      }
    } catch (_) {}
    return null;
  }

  function saveShortcuts(shortcuts) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ shortcuts: shortcuts }));
    } catch (_) {}
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  function getInitials(label) {
    if (!label) return "?";
    var words = label.trim().split(/\s+/);
    if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
    return label.slice(0, 2).toUpperCase();
  }

  function getContrastColor(hex) {
    if (!hex) return "#ffffff";
    var c = hex.replace("#", "");
    if (c.length === 3) c = c[0]+c[0]+c[1]+c[1]+c[2]+c[2];
    var r = parseInt(c.slice(0,2), 16);
    var g = parseInt(c.slice(2,4), 16);
    var b = parseInt(c.slice(4,6), 16);
    var lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return lum > 0.5 ? "#000000" : "#ffffff";
  }

  function generateId() {
    return Math.random().toString(36).slice(2, 10);
  }

  // Returns the src URL used to display the shortcut icon in a tile.
  // All requests go through /api/plugin/shortcuts/icon which runs server-side,
  // so it can reach private-network hosts and has permissive content-type handling.
  //
  // Priority:
  //   1. sc.iconUrl  — user-supplied custom icon URL
  //   2. sc.iconSrc  — pre-built /icon?url=...&candidates=... from site-info (best)
  //   3. sc.faviconUrl — raw primary icon URL discovered from site-info
  //   4. /favicon.ico on the site origin (last resort)
  function getIconSrc(sc) {
    if (sc.iconUrl && sc.iconUrl.trim()) {
      return "/api/plugin/shortcuts/icon?url=" + encodeURIComponent(sc.iconUrl.trim());
    }
    if (sc.iconSrc && sc.iconSrc.trim()) {
      // Already a fully-formed /icon?... request, use as-is
      return sc.iconSrc.trim();
    }
    if (sc.faviconUrl && sc.faviconUrl.trim()) {
      return "/api/plugin/shortcuts/icon?url=" + encodeURIComponent(sc.faviconUrl.trim());
    }
    try {
      var origin = new URL(sc.url).origin;
      return "/api/plugin/shortcuts/icon?url=" + encodeURIComponent(origin + "/favicon.ico");
    } catch (_) { return ""; }
  }

  // ─── Settings ─────────────────────────────────────────────────────────────

  // Default true so the add button shows before settings load,
  // but we won't render until after settings are fetched.
  var pluginSettings = { showAddButton: true, openInNewTab: false };

  function loadPluginSettings() {
    return fetch("/api/extensions")
      .then(function (r) { return r.ok ? r.json() : {}; })
      .then(function (data) {
        // Response shape: { engines: [...], plugins: [...], themes: [...] }
        var plugins = (data && Array.isArray(data.plugins)) ? data.plugins : [];
        var ext = null;
        for (var i = 0; i < plugins.length; i++) {
          if (plugins[i].id === "plugin-shortcuts") { ext = plugins[i]; break; }
        }
        if (ext && ext.settings) {
          // toggles are stored as "true"/"false" strings; unset defaults to true
          var rawShow = ext.settings.showAddButton;
          pluginSettings.showAddButton = (rawShow === undefined || rawShow === null || rawShow === "true");
          pluginSettings.openInNewTab  = ext.settings.openInNewTab === "true";
        }
      })
      .catch(function () {});
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  var container = null;
  var shortcuts = [];

  function renderShortcutTile(sc) {
    var tile = document.createElement("a");
    tile.className = "sc-tile";
    tile.href = sc.url;
    tile.dataset.id = sc.id;
    if (pluginSettings.openInNewTab) {
      tile.target = "_blank";
      tile.rel = "noopener";
    }
    tile.title = sc.label;

    // Icon container
    var iconWrap = document.createElement("div");
    iconWrap.className = "sc-tile-icon";
    if (sc.color) iconWrap.style.background = sc.color;
    // Per-icon size: stored as integer 20–100 (percent of tile). Default 65.
    var iconPct = (typeof sc.iconSize === "number" && sc.iconSize >= 20 && sc.iconSize <= 100)
      ? sc.iconSize : 65;
    iconWrap.style.setProperty("--sc-icon-size", iconPct + "%");

    // Icon image
    var img = document.createElement("img");
    img.className = "sc-tile-favicon";
    img.src = getIconSrc(sc);
    img.alt = "";
    img.loading = "lazy";

    // Initials fallback
    var initials = document.createElement("span");
    initials.className = "sc-tile-initials";
    initials.textContent = getInitials(sc.label);
    if (sc.color) initials.style.color = getContrastColor(sc.color);

    img.onerror = function () {
      img.style.display = "none";
      initials.style.display = "flex";
    };

    iconWrap.appendChild(img);
    iconWrap.appendChild(initials);

    var labelEl = document.createElement("span");
    labelEl.className = "sc-tile-label";
    labelEl.textContent = sc.label;

    // Edit button (shown on hover)
    var editBtn = document.createElement("button");
    editBtn.className = "sc-tile-edit";
    editBtn.type = "button";
    editBtn.title = "Edit shortcut";
    editBtn.setAttribute("aria-label", "Edit " + sc.label);
    editBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';

    editBtn.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      openModal(sc);
    });

    tile.appendChild(iconWrap);
    tile.appendChild(labelEl);
    tile.appendChild(editBtn);
    return tile;
  }

  function renderAddTile() {
    var tile = document.createElement("button");
    tile.className = "sc-tile sc-tile-add";
    tile.type = "button";
    tile.title = "Add shortcut";

    var iconWrap = document.createElement("div");
    iconWrap.className = "sc-tile-icon sc-tile-add-icon";
    iconWrap.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';

    var labelEl = document.createElement("span");
    labelEl.className = "sc-tile-label";
    labelEl.textContent = "Add";

    tile.appendChild(iconWrap);
    tile.appendChild(labelEl);
    tile.addEventListener("click", function () { openModal(null); });
    return tile;
  }

  function renderGrid() {
    if (!container) return;
    container.innerHTML = "";
    for (var i = 0; i < shortcuts.length; i++) {
      container.appendChild(renderShortcutTile(shortcuts[i]));
    }
    if (pluginSettings.showAddButton) {
      container.appendChild(renderAddTile());
    }
  }

  // ─── Modal ────────────────────────────────────────────────────────────────

  var modal = null;
  var modalOverlay = null;
  var currentEditId = null;

  function buildModal() {
    modalOverlay = document.createElement("div");
    modalOverlay.className = "sc-modal-overlay";
    modalOverlay.addEventListener("click", function (e) {
      if (e.target === modalOverlay) closeModal();
    });

    modal = document.createElement("div");
    modal.className = "sc-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");

    modal.innerHTML = [
      '<div class="sc-modal-header">',
      '  <h2 class="sc-modal-title" id="sc-modal-title">Add Shortcut</h2>',
      '  <button class="sc-modal-close" type="button" aria-label="Close">&times;</button>',
      '</div>',
      '<form class="sc-modal-form" id="sc-modal-form" autocomplete="off">',

      // URL row with inline favicon preview
      '  <div class="sc-modal-field">',
      '    <label class="sc-modal-label" for="sc-input-url">URL</label>',
      '    <div class="sc-modal-url-row">',
      '      <input class="sc-modal-input" id="sc-input-url" type="url" placeholder="https://jellyfin.local:8096" required />',
      '      <div class="sc-modal-url-preview" id="sc-url-preview" style="display:none">',
      '        <img class="sc-modal-favicon" id="sc-modal-favicon" src="" alt="" />',
      '      </div>',
      '    </div>',
      '  </div>',

      // Name
      '  <div class="sc-modal-field">',
      '    <label class="sc-modal-label" for="sc-input-label">',
      '      Name',
      '      <span class="sc-modal-label-hint" id="sc-label-hint" style="display:none"> \u2014 fetching\u2026</span>',
      '    </label>',
      '    <input class="sc-modal-input" id="sc-input-label" type="text" placeholder="Jellyfin" maxlength="32" required />',
      '  </div>',

      // Custom icon URL (optional)
      '  <div class="sc-modal-field">',
      '    <label class="sc-modal-label" for="sc-input-icon">Custom icon URL <span class="sc-modal-label-opt">(optional)</span></label>',
      '    <input class="sc-modal-input" id="sc-input-icon" type="url" placeholder="https://example.com/icon.png" />',
      '    <span class="sc-modal-field-hint">Overrides the auto-detected icon. Leave blank to use the site\'s own icon.</span>',
      '  </div>',

      // Icon size slider
      '  <div class="sc-modal-field">',
      '    <label class="sc-modal-label" for="sc-input-size">Icon size</label>',
      '    <div class="sc-modal-size-row">',
      '      <input class="sc-modal-size-slider" id="sc-input-size" type="range" min="20" max="100" step="5" value="65" />',
      '      <span class="sc-modal-size-value" id="sc-size-value">65%</span>',
      '    </div>',
      '  </div>',

      // Color
      '  <div class="sc-modal-field">',
      '    <label class="sc-modal-label" for="sc-input-color">Background color <span class="sc-modal-label-opt">(optional)</span></label>',
      '    <div class="sc-modal-color-row">',
      '      <input class="sc-modal-color-picker" id="sc-input-color" type="color" value="#4285f4" />',
      '      <input class="sc-modal-input sc-modal-color-text" id="sc-input-color-text" type="text" placeholder="none" maxlength="7" />',
      '      <button class="sc-modal-btn-clear-color" type="button" id="sc-btn-clear-color">Clear</button>',
      '    </div>',
      '  </div>',

      // Actions
      '  <div class="sc-modal-actions">',
      '    <button class="sc-modal-btn sc-modal-btn-delete" type="button" id="sc-btn-delete" style="display:none">Remove</button>',
      '    <div class="sc-modal-actions-right">',
      '      <button class="sc-modal-btn sc-modal-btn-cancel" type="button" id="sc-btn-cancel">Cancel</button>',
      '      <button class="sc-modal-btn sc-modal-btn-save" type="submit" id="sc-btn-save">Save</button>',
      '    </div>',
      '  </div>',
      '</form>',
    ].join("");

    modalOverlay.appendChild(modal);
    document.body.appendChild(modalOverlay);

    modal.querySelector(".sc-modal-close").addEventListener("click", closeModal);
    modal.querySelector("#sc-btn-cancel").addEventListener("click", closeModal);

    // Color picker <-> text input sync
    var colorPicker = modal.querySelector("#sc-input-color");
    var colorText   = modal.querySelector("#sc-input-color-text");
    var clearColor  = modal.querySelector("#sc-btn-clear-color");

    colorPicker.addEventListener("input", function () { colorText.value = colorPicker.value; });
    colorText.addEventListener("input", function () {
      var v = colorText.value.trim();
      if (/^#[0-9a-fA-F]{6}$/.test(v)) colorPicker.value = v;
    });
    clearColor.addEventListener("click", function () {
      colorText.value = "";
      colorPicker.value = "#4285f4";
    });

    // Icon size slider
    var sizeSlider = modal.querySelector("#sc-input-size");
    var sizeValue  = modal.querySelector("#sc-size-value");
    sizeSlider.addEventListener("input", function () {
      sizeValue.textContent = sizeSlider.value + "%";
    });

    // ── Auto-fetch site info on URL entry ────────────────────────────────────
    var urlInput     = modal.querySelector("#sc-input-url");
    var labelInput   = modal.querySelector("#sc-input-label");
    var iconInput    = modal.querySelector("#sc-input-icon");
    var labelHint    = modal.querySelector("#sc-label-hint");
    var urlPreview   = modal.querySelector("#sc-url-preview");
    var modalFavicon = modal.querySelector("#sc-modal-favicon");
    var lastFetchedUrl = "";

    function normalizeUrl(raw) {
      var v = raw.trim();
      if (!v) return "";
      if (!/^https?:\/\//i.test(v)) v = "https://" + v;
      try { new URL(v); return v; } catch (_) { return ""; }
    }

    function showFaviconPreview(src) {
      if (!src) { urlPreview.style.display = "none"; return; }
      modalFavicon.src = src;
      modalFavicon.onerror = function () { urlPreview.style.display = "none"; };
      modalFavicon.onload  = function () { urlPreview.style.display = "flex"; };
    }

    function fetchSiteInfo(url) {
      if (!url || url === lastFetchedUrl) return;
      lastFetchedUrl = url;

      var userTypedLabel = labelInput.value.trim();
      var userTypedIcon  = iconInput.value.trim();

      // Show a placeholder via our own /icon route immediately while we wait
      if (!userTypedIcon) {
        try {
          var origin = new URL(url).origin;
          showFaviconPreview(
            "/api/plugin/shortcuts/icon?url=" + encodeURIComponent(origin + "/favicon.ico")
          );
        } catch (_) {}
      }

      if (!userTypedLabel) labelHint.style.display = "inline";

      fetch("/api/plugin/shortcuts/site-info?url=" + encodeURIComponent(url))
        .then(function (r) { return r.ok ? r.json() : {}; })
        .then(function (data) {
          labelHint.style.display = "none";

          // Auto-fill name only if user hasn't typed one
          if (data.title && !labelInput.value.trim()) {
            labelInput.value = data.title.slice(0, 32);
          }

          // iconCandidates is an ordered list of URLs to try, best first.
          // Build a single /icon?url=<primary>&candidates=<rest> request so
          // the server tries them in order and returns the first that works.
          var candidates = Array.isArray(data.iconCandidates) ? data.iconCandidates : [];
          if (candidates.length > 0 && !iconInput.value.trim()) {
            var primary = candidates[0];
            var rest    = candidates.slice(1);
            var iconSrc = "/api/plugin/shortcuts/icon?url=" + encodeURIComponent(primary);
            if (rest.length > 0) {
              iconSrc += "&candidates=" + encodeURIComponent(rest.join(","));
            }
            showFaviconPreview(iconSrc);
            // Store the best candidate URL so it can be saved on the shortcut
            modal._pendingFaviconUrl = primary;
            modal._pendingIconSrc    = iconSrc;
          }
        })
        .catch(function () { labelHint.style.display = "none"; });
    }

    urlInput.addEventListener("blur", function () {
      var url = normalizeUrl(urlInput.value);
      if (url) { urlInput.value = url; fetchSiteInfo(url); }
    });
    urlInput.addEventListener("paste", function () {
      setTimeout(function () {
        var url = normalizeUrl(urlInput.value);
        if (url) fetchSiteInfo(url);
      }, 0);
    });

    // When user types a custom icon URL, update the preview
    iconInput.addEventListener("blur", function () {
      var v = iconInput.value.trim();
      if (v) showFaviconPreview(v);
    });

    // Delete button
    modal.querySelector("#sc-btn-delete").addEventListener("click", function () {
      if (!currentEditId) return;
      shortcuts = shortcuts.filter(function (sc) { return sc.id !== currentEditId; });
      saveShortcuts(shortcuts);
      renderGrid();
      closeModal();
    });

    // Form submit
    modal.querySelector("#sc-modal-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var labelVal   = labelInput.value.trim();
      var urlVal     = normalizeUrl(urlInput.value) || urlInput.value.trim();
      var iconVal    = iconInput.value.trim() || null;
      var iconSzVal  = parseInt(sizeSlider.value, 10) || 65;
      var colorVal   = colorText.value.trim();
      var colorFinal = /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(colorVal) ? colorVal : null;

      if (!labelVal || !urlVal) return;

      // faviconUrl = the raw icon URL (primary candidate from site-info).
      // iconSrc    = the /icon?url=...&candidates=... string used by getIconSrc().
      var faviconVal = iconVal ? null : (modal._pendingFaviconUrl || null);
      var iconSrcVal = iconVal ? null : (modal._pendingIconSrc    || null);

      if (currentEditId) {
        for (var i = 0; i < shortcuts.length; i++) {
          if (shortcuts[i].id === currentEditId) {
            shortcuts[i].label      = labelVal;
            shortcuts[i].url        = urlVal;
            shortcuts[i].iconUrl    = iconVal;
            shortcuts[i].faviconUrl = iconVal ? null : (faviconVal || shortcuts[i].faviconUrl);
            shortcuts[i].iconSrc    = iconVal ? null : (iconSrcVal || shortcuts[i].iconSrc);
            shortcuts[i].iconSize   = iconSzVal;
            shortcuts[i].color      = colorFinal;
            break;
          }
        }
      } else {
        shortcuts.push({
          id:         generateId(),
          label:      labelVal,
          url:        urlVal,
          iconUrl:    iconVal,
          faviconUrl: faviconVal,
          iconSrc:    iconSrcVal,
          iconSize:   iconSzVal,
          color:      colorFinal,
        });
      }

      saveShortcuts(shortcuts);
      renderGrid();
      closeModal();
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && modalOverlay.classList.contains("sc-modal-visible")) {
        closeModal();
      }
    });
  }

  function openModal(sc) {
    if (!modal) buildModal();

    currentEditId = sc ? sc.id : null;
    modal._pendingFaviconUrl = null;
    modal._pendingIconSrc    = null;

    var titleEl      = modal.querySelector("#sc-modal-title");
    var urlInput     = modal.querySelector("#sc-input-url");
    var labelInput   = modal.querySelector("#sc-input-label");
    var iconInput    = modal.querySelector("#sc-input-icon");
    var sizeSlider   = modal.querySelector("#sc-input-size");
    var sizeValue    = modal.querySelector("#sc-size-value");
    var colorPicker  = modal.querySelector("#sc-input-color");
    var colorText    = modal.querySelector("#sc-input-color-text");
    var deleteBtn    = modal.querySelector("#sc-btn-delete");
    var urlPreview   = modal.querySelector("#sc-url-preview");
    var modalFavicon = modal.querySelector("#sc-modal-favicon");
    var labelHint    = modal.querySelector("#sc-label-hint");

    labelHint.style.display = "none";

    if (sc) {
      titleEl.textContent  = "Edit Shortcut";
      urlInput.value       = sc.url   || "";
      labelInput.value     = sc.label || "";
      iconInput.value      = sc.iconUrl || "";
      var sz = (typeof sc.iconSize === "number" && sc.iconSize >= 20 && sc.iconSize <= 100) ? sc.iconSize : 65;
      sizeSlider.value     = sz;
      sizeValue.textContent = sz + "%";
      var c = sc.color || "";
      colorText.value      = c;
      colorPicker.value    = /^#[0-9a-fA-F]{6}$/.test(c) ? c : "#4285f4";
      deleteBtn.style.display = "inline-flex";

      // Show the stored icon in the preview using the same logic as the tile
      var previewSrc = getIconSrc(sc);
      if (previewSrc) {
        modalFavicon.src = previewSrc;
        modalFavicon.onerror = function () { urlPreview.style.display = "none"; };
        modalFavicon.onload  = function () { urlPreview.style.display = "flex"; };
      } else {
        urlPreview.style.display = "none";
      }
      modal._pendingFaviconUrl = sc.faviconUrl || null;
      modal._pendingIconSrc    = sc.iconSrc    || null;
    } else {
      titleEl.textContent  = "Add Shortcut";
      urlInput.value       = "";
      labelInput.value     = "";
      iconInput.value      = "";
      sizeSlider.value     = 65;
      sizeValue.textContent = "65%";
      colorText.value      = "";
      colorPicker.value    = "#4285f4";
      deleteBtn.style.display = "none";
      urlPreview.style.display = "none";
      modalFavicon.src     = "";
    }

    modalOverlay.classList.add("sc-modal-visible");
    setTimeout(function () { urlInput.focus(); }, 50);
  }

  function closeModal() {
    if (modalOverlay) modalOverlay.classList.remove("sc-modal-visible");
    currentEditId = null;
  }

  // ─── Init ─────────────────────────────────────────────────────────────────

  function init(defaultShortcutsFromServer) {
    var stored = loadShortcuts();
    if (stored) {
      shortcuts = stored.shortcuts;
    } else {
      shortcuts = defaultShortcutsFromServer || [];
      saveShortcuts(shortcuts);
    }

    var main = document.getElementById("main-home");
    if (!main) return;

    container = document.createElement("div");
    container.className = "sc-grid";
    container.setAttribute("aria-label", "Shortcuts");

    var searchContainer = main.querySelector(".search-container");
    if (searchContainer) {
      main.insertBefore(container, searchContainer);
    } else {
      main.appendChild(container);
    }

    renderGrid();
  }

  // Load settings first, then defaults, then init — so showAddButton is correct from the start
  loadPluginSettings()
    .then(function () {
      return fetch("/api/plugin/shortcuts/defaults")
        .then(function (r) { return r.ok ? r.json() : []; })
        .catch(function () { return []; });
    })
    .then(function (defaults) {
      init(defaults);
    });
})();
