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

  function escHtml(str) {
    var el = document.createElement("span");
    el.textContent = String(str);
    return el.innerHTML;
  }

  function getFaviconUrl(url) {
    try {
      var hostname = new URL(url).hostname;
      return "/api/proxy/image?url=" + encodeURIComponent(
        "https://www.google.com/s2/favicons?domain=" + hostname + "&sz=64"
      );
    } catch (_) {
      return "";
    }
  }

  function getInitials(label) {
    if (!label) return "?";
    var words = label.trim().split(/\s+/);
    if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
    return label.slice(0, 2).toUpperCase();
  }

  function getContrastColor(hex) {
    // Return black or white depending on background luminance
    if (!hex) return "#ffffff";
    var c = hex.replace("#", "");
    if (c.length === 3) c = c[0]+c[0]+c[1]+c[1]+c[2]+c[2];
    var r = parseInt(c.slice(0,2), 16);
    var g = parseInt(c.slice(2,4), 16);
    var b = parseInt(c.slice(4,6), 16);
    // Relative luminance
    var lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return lum > 0.5 ? "#000000" : "#ffffff";
  }

  function generateId() {
    return Math.random().toString(36).slice(2, 10);
  }

  // ─── Settings ─────────────────────────────────────────────────────────────

  var pluginSettings = { showAddButton: true, openInNewTab: false };

  function loadPluginSettings() {
    // Read settings from the <meta> tags injected by the plugin or from
    // data attributes, but since we can't read plugin settings directly
    // in the browser we fetch them from the extension API.
    return fetch("/api/extensions")
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (extensions) {
        var ext = null;
        if (Array.isArray(extensions)) {
          for (var i = 0; i < extensions.length; i++) {
            if (extensions[i].id === "plugin-shortcuts") { ext = extensions[i]; break; }
          }
        }
        if (ext && ext.settings) {
          pluginSettings.showAddButton  = ext.settings.showAddButton  !== "false";
          pluginSettings.openInNewTab   = ext.settings.openInNewTab   === "true";
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
    tile.title = escHtml(sc.label);

    // Icon container
    var iconWrap = document.createElement("div");
    iconWrap.className = "sc-tile-icon";
    if (sc.color) {
      iconWrap.style.background = sc.color;
    }

    // Favicon image with fallback to initials
    var img = document.createElement("img");
    img.className = "sc-tile-favicon";
    img.src = getFaviconUrl(sc.url);
    img.alt = "";
    img.loading = "lazy";

    var initials = document.createElement("span");
    initials.className = "sc-tile-initials";
    initials.textContent = getInitials(sc.label);
    if (sc.color) {
      initials.style.color = getContrastColor(sc.color);
    }

    img.onerror = function () {
      img.style.display = "none";
      initials.style.display = "flex";
    };

    iconWrap.appendChild(img);
    iconWrap.appendChild(initials);

    var label = document.createElement("span");
    label.className = "sc-tile-label";
    label.textContent = sc.label;

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
    tile.appendChild(label);
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

    var label = document.createElement("span");
    label.className = "sc-tile-label";
    label.textContent = "Add";

    tile.appendChild(iconWrap);
    tile.appendChild(label);

    tile.addEventListener("click", function () {
      openModal(null);
    });

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
    // Overlay
    modalOverlay = document.createElement("div");
    modalOverlay.className = "sc-modal-overlay";
    modalOverlay.addEventListener("click", function (e) {
      if (e.target === modalOverlay) closeModal();
    });

    // Modal box
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
      '  <div class="sc-modal-field">',
      '    <label class="sc-modal-label" for="sc-input-label">Name</label>',
      '    <input class="sc-modal-input" id="sc-input-label" type="text" placeholder="YouTube" maxlength="32" required />',
      '  </div>',
      '  <div class="sc-modal-field">',
      '    <label class="sc-modal-label" for="sc-input-url">URL</label>',
      '    <input class="sc-modal-input" id="sc-input-url" type="url" placeholder="https://youtube.com" required />',
      '  </div>',
      '  <div class="sc-modal-field sc-modal-field-color">',
      '    <label class="sc-modal-label" for="sc-input-color">Color (optional)</label>',
      '    <div class="sc-modal-color-row">',
      '      <input class="sc-modal-color-picker" id="sc-input-color" type="color" value="#4285f4" />',
      '      <input class="sc-modal-input sc-modal-color-text" id="sc-input-color-text" type="text" placeholder="#4285f4" maxlength="7" />',
      '      <button class="sc-modal-btn-clear-color" type="button" id="sc-btn-clear-color">Clear</button>',
      '    </div>',
      '  </div>',
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

    // Wire up close button
    modal.querySelector(".sc-modal-close").addEventListener("click", closeModal);
    modal.querySelector("#sc-btn-cancel").addEventListener("click", closeModal);

    // Color picker <-> text input sync
    var colorPicker = modal.querySelector("#sc-input-color");
    var colorText   = modal.querySelector("#sc-input-color-text");
    var clearColor  = modal.querySelector("#sc-btn-clear-color");

    colorPicker.addEventListener("input", function () {
      colorText.value = colorPicker.value;
    });
    colorText.addEventListener("input", function () {
      var v = colorText.value.trim();
      if (/^#[0-9a-fA-F]{6}$/.test(v)) {
        colorPicker.value = v;
      }
    });
    clearColor.addEventListener("click", function () {
      colorText.value = "";
      colorPicker.value = "#4285f4";
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
      var labelVal = modal.querySelector("#sc-input-label").value.trim();
      var urlVal   = modal.querySelector("#sc-input-url").value.trim();
      var colorVal = modal.querySelector("#sc-input-color-text").value.trim();

      if (!labelVal || !urlVal) return;

      // Ensure URL has a protocol
      if (!/^https?:\/\//i.test(urlVal)) {
        urlVal = "https://" + urlVal;
      }

      var colorFinal = /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(colorVal) ? colorVal : null;

      if (currentEditId) {
        // Edit existing
        for (var i = 0; i < shortcuts.length; i++) {
          if (shortcuts[i].id === currentEditId) {
            shortcuts[i].label = labelVal;
            shortcuts[i].url   = urlVal;
            shortcuts[i].color = colorFinal;
            break;
          }
        }
      } else {
        // Add new
        shortcuts.push({
          id:    generateId(),
          label: labelVal,
          url:   urlVal,
          color: colorFinal,
        });
      }

      saveShortcuts(shortcuts);
      renderGrid();
      closeModal();
    });

    // Close on Escape
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && modalOverlay.classList.contains("sc-modal-visible")) {
        closeModal();
      }
    });
  }

  function openModal(sc) {
    if (!modal) buildModal();

    currentEditId = sc ? sc.id : null;

    var titleEl   = modal.querySelector("#sc-modal-title");
    var labelInput = modal.querySelector("#sc-input-label");
    var urlInput   = modal.querySelector("#sc-input-url");
    var colorPicker = modal.querySelector("#sc-input-color");
    var colorText   = modal.querySelector("#sc-input-color-text");
    var deleteBtn   = modal.querySelector("#sc-btn-delete");

    if (sc) {
      titleEl.textContent = "Edit Shortcut";
      labelInput.value = sc.label || "";
      urlInput.value   = sc.url   || "";
      var c = sc.color || "";
      colorText.value  = c;
      colorPicker.value = /^#[0-9a-fA-F]{6}$/.test(c) ? c : "#4285f4";
      deleteBtn.style.display = "inline-flex";
    } else {
      titleEl.textContent = "Add Shortcut";
      labelInput.value = "";
      urlInput.value   = "";
      colorText.value  = "";
      colorPicker.value = "#4285f4";
      deleteBtn.style.display = "none";
    }

    modalOverlay.classList.add("sc-modal-visible");
    setTimeout(function () { labelInput.focus(); }, 50);
  }

  function closeModal() {
    if (modalOverlay) {
      modalOverlay.classList.remove("sc-modal-visible");
    }
    currentEditId = null;
  }

  // ─── Init ─────────────────────────────────────────────────────────────────

  function init(defaultShortcutsFromServer) {
    var stored = loadShortcuts();
    if (stored) {
      shortcuts = stored.shortcuts;
    } else {
      // First visit: use server-provided defaults, save them
      shortcuts = defaultShortcutsFromServer || [];
      saveShortcuts(shortcuts);
    }

    // Build the container and insert above the search bar
    var main = document.getElementById("main-home");
    if (!main) return;

    container = document.createElement("div");
    container.className = "sc-grid";
    container.setAttribute("aria-label", "Shortcuts");

    // Insert before .search-container, which is after .logo-container
    var searchContainer = main.querySelector(".search-container");
    if (searchContainer) {
      main.insertBefore(container, searchContainer);
    } else {
      main.appendChild(container);
    }

    renderGrid();
  }

  // Fetch defaults from server, then initialize
  fetch("/api/plugin/shortcuts/defaults")
    .then(function (r) { return r.ok ? r.json() : []; })
    .catch(function () { return []; })
    .then(function (defaults) {
      return loadPluginSettings().then(function () { return defaults; });
    })
    .then(function (defaults) {
      init(defaults);
    });
})();
