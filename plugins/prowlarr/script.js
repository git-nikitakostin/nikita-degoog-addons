// ─── Bencode parser (browser, no deps) ───────────────────────────────────────

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
    for (let j = i + 1; j < buf.length; j++) {
      if (buf[j] === 101) return j + 1;
    }
    return -1;
  }
  if (c >= 48 && c <= 57) { // string "len:data"
    let colon = -1;
    for (let j = i; j < buf.length; j++) {
      if (buf[j] === 58) { colon = j; break; }
    }
    if (colon === -1) return -1;
    const lenStr = String.fromCharCode(...buf.slice(i, colon));
    const len = parseInt(lenStr, 10);
    return colon + 1 + len;
  }
  return -1;
}

async function torrentBufToMagnet(buf, title) {
  // Find "4:info" marker
  const marker = [52, 58, 105, 110, 102, 111]; // "4:info"
  let idx = -1;
  outer: for (let i = 0; i <= buf.length - marker.length; i++) {
    for (let j = 0; j < marker.length; j++) {
      if (buf[i + j] !== marker[j]) continue outer;
    }
    idx = i;
    break;
  }
  if (idx === -1) return null;

  const start = idx + marker.length;
  const end = bencodeSkip(buf, start);
  if (end === -1) return null;

  const infoSlice = buf.slice(start, end);
  const hashBuf = await crypto.subtle.digest("SHA-1", infoSlice);
  const hashArr = Array.from(new Uint8Array(hashBuf));
  const hash = hashArr.map((b) => b.toString(16).padStart(2, "0")).join("");

  const dn = encodeURIComponent(title || "");
  return `magnet:?xt=urn:btih:${hash}&dn=${dn}`;
}

// ─── Button handler ───────────────────────────────────────────────────────────

async function handleGenMagnet(btn) {
  const torrentUrl = btn.dataset.torrentUrl;
  const title = btn.dataset.title || "";
  if (!torrentUrl) return;

  btn.textContent = "\u23F3 Generating\u2026";
  btn.disabled = true;

  try {
    const res = await fetch(torrentUrl, { redirect: "follow" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const arrayBuf = await res.arrayBuffer();
    const buf = new Uint8Array(arrayBuf);
    const magnet = await torrentBufToMagnet(buf, title);
    if (!magnet) throw new Error("Could not parse torrent");

    // Replace button with a real magnet link
    const link = document.createElement("a");
    link.href = magnet;
    link.className = "prowlarr-btn prowlarr-btn-magnet";
    link.textContent = "\uD83E\uDDF2 Magnet";
    btn.replaceWith(link);
  } catch {
    btn.textContent = "\u26A0\uFE0F Failed";
    btn.disabled = false;
    btn.style.opacity = "0.6";
  }
}

// ─── Event delegation ─────────────────────────────────────────────────────────

document.addEventListener("click", (e) => {
  const btn = e.target.closest(".prowlarr-btn-gen");
  if (!btn) return;
  e.preventDefault();
  handleGenMagnet(btn);
});
