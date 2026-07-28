/* MTG Sealed Collecting Binder — frontend.
   Talks to the Node backend for checklist data and live Google Drive sync.
   Falls back to localStorage when Drive isn't connected. */

const LS = "mtgBinder_v1";
let DATA = null;
let state = loadLocal();
let server = { configured: false, connected: false, email: null };
let active = state.ui.active || null;
let search = "";
let saveTimer = null;
let livePrices = {};
let pricePoll = null;
const priceKey = (clId, name) => clId + "::" + name;
const LEGACY_KEY_RE = /^([^|]+)\|(\d+)\|(\d+)\|(\d+)$/;
let LEGACY_KEYS = {};

function loadLocal() {
  try { const s = JSON.parse(localStorage.getItem(LS)); if (s && s.checks) return s; } catch (e) {}
  return { checks: {}, ui: { active: null, hideDone: false, closed: {} }, theme: "light" };
}
function saveLocal() { localStorage.setItem(LS, JSON.stringify(state)); }

const normKeyPart = (v) => String(v || "").normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
function contentHash(v) {
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < v.length; i++) { h ^= BigInt(v.charCodeAt(i)); h = BigInt.asUintN(64, h * 0x100000001b3n); }
  return h.toString(16).padStart(16, "0");
}
function keyFor(cl, it, si) {
  const sl = it.slots[si], group = normKeyPart(sl.g || sl.l);
  const ordinal = it.slots.slice(0, si).filter(s => normKeyPart(s.g || s.l) === group).length;
  return `${cl}|v2|${contentHash([normKeyPart(cl), normKeyPart(it.name), normKeyPart(it.code), group, ordinal].join("\u001f"))}`;
}
function buildLegacyKeyMap() {
  const out = {}, seen = new Set();
  DATA.checklists.forEach(cl => cl.eras.forEach((era, ei) => era.items.forEach((it, ii) =>
    it.slots.forEach((sl, si) => {
      const old = `${cl.id}|${ei}|${ii}|${si}`, next = keyFor(cl.id, it, si);
      if (seen.has(next)) throw new Error(`Duplicate content key: ${next}`);
      seen.add(next); out[old] = next;
    }))));
  return out;
}
function migrateStateChecks() {
  const current = {}, legacy = {}, unknown = {}; let migrated = 0;
  for (const [k, v] of Object.entries(state.checks || {})) { if (!v) continue;
    if (LEGACY_KEY_RE.test(k)) {
      legacy[k] = true;
      if (LEGACY_KEYS[k]) { current[LEGACY_KEYS[k]] = true; migrated++; } else unknown[k] = true;
    } else current[k] = true;
  }
  if (migrated || Object.keys(unknown).length) {
    state.checks = current;
    state.legacyChecksV1 = Object.assign({}, state.legacyChecksV1 || {}, legacy, unknown);
    state.keyMigration = { from: 1, to: 2, migrated, unknown: Object.keys(unknown).length, at: new Date().toISOString() };
  }
  state.keyVersion = 2;
  return migrated || Object.keys(unknown).length;
}
const isChecked = (k) => !!state.checks[k];
const pct = (d, t) => (t ? Math.round((d / t) * 100) : 0);

function clProgress(cl) {
  let done = 0, total = 0;
  cl.eras.forEach((e, ei) => e.items.forEach((it, ii) => it.slots.forEach((sl, si) => {
    total++; if (isChecked(keyFor(cl.id, it, si))) done++;
  })));
  return { done, total };
}
function eraProgress(cl, ei) {
  let done = 0, total = 0;
  cl.eras[ei].items.forEach((it, ii) => it.slots.forEach((sl, si) => {
    total++; if (isChecked(keyFor(cl.id, it, si))) done++;
  }));
  return { done, total };
}
function overall() {
  let done = 0, total = 0;
  DATA.checklists.forEach(cl => { const p = clProgress(cl); done += p.done; total += p.total; });
  return { done, total };
}

/* ---------------- server sync ---------------- */
async function refreshStatus() {
  try { server = await (await fetch("/api/status")).json(); } catch (e) {}
  paintDrive();
}
async function pullProgress() {
  if (!server.connected) return;
  try {
    const r = await fetch("/api/progress");
    if (r.ok) {
      const body = await r.json();
      if (body.checks) {
        state.checks = body.checks;
        state.legacyChecksV1 = Object.assign({}, body.legacyChecksV1 || {}, state.legacyChecksV1 || {});
        const migrated = migrateStateChecks(); saveLocal(); if (migrated) scheduleSave();
      }
    }
  } catch (e) {}
}
function scheduleSave() {
  saveLocal();
  if (!server.connected) return;
  document.getElementById("driveTxt").textContent = "Saving…";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      const r = await fetch("/api/progress", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ checks: state.checks, keyVersion: 2,
          legacyChecksV1: state.legacyChecksV1 || {}, keyMigration: state.keyMigration || null })
      });
      if (r.ok) { const j = await r.json(); state.drive = { last: Date.parse(j.savedAt) }; paintDrive(); }
      else paintDrive();
    } catch (e) { paintDrive(); }
  }, 600);
}
function paintDrive() {
  const dot = document.getElementById("driveDot"), txt = document.getElementById("driveTxt");
  if (server.connected) {
    dot.classList.add("on");
    txt.textContent = (state.drive && state.drive.last) ? "Synced " + timeAgo(state.drive.last)
                      : (server.label || "Backup connected");
  } else { dot.classList.remove("on"); txt.textContent = "Backup: off"; }
  const beName = server.backend === "gist" ? "GitHub Gist" : "Google Drive";
  document.getElementById("brandSub").textContent =
    server.connected ? "synced to " + beName : "local — connect backup to sync";
}
function timeAgo(t) { const s = Math.floor((Date.now() - t) / 1000);
  if (s < 60) return "just now"; if (s < 3600) return Math.floor(s / 60) + "m ago"; return Math.floor(s / 3600) + "h ago"; }

/* ---------------- render ---------------- */
function renderTabs() {
  const el = document.getElementById("tabs"); el.innerHTML = "";
  DATA.checklists.forEach(cl => {
    const p = clProgress(cl), pc = pct(p.done, p.total);
    const d = document.createElement("div");
    d.className = "tab" + (cl.id === active ? " active" : "");
    d.innerHTML = `<div class="tt"><span>${cl.title}</span><span class="tpct">${pc}%</span></div>
      <div class="tbar"><i style="width:${pc}%"></i></div>
      <div class="tsub">${p.done} / ${p.total} collected</div>`;
    d.onclick = () => { active = cl.id; state.ui.active = active; saveLocal(); renderTabs(); renderContent(); };
    el.appendChild(d);
  });
}
/* "$144 / $1,200" → faint MSRP, bold market (market is what matters) */
function valueHTML(val, est) {
  if (!val) return "";
  if (val.indexOf(" / ") > -1) {
    const p = val.split(" / ");
    const mkt = p[1].trim(), tba = /TBA/i.test(mkt);
    return '<span style="color:var(--muted);font-weight:400;font-size:10.5px">' + p[0].trim() + "</span>" +
      ' <span style="font-weight:800;' + (tba ? "font-style:italic;color:var(--muted)" : (est ? "color:var(--gold)" : "")) + '">' + mkt + "</span>";
  }
  return val;
}
function applyCols(){
  const c=document.getElementById("content"); const v=(state.ui.cols||"auto");
  if(v==="auto"){ c.style.columnCount=""; c.style.columnWidth="480px"; }
  else { c.style.columnWidth="auto"; c.style.columnCount=v; }
  const sel=document.getElementById("colSel"); if(sel) sel.value=v;
}
const checkSVG = () => '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 6"/></svg>';

function renderContent() {
  const cl = DATA.checklists.find(c => c.id === active);
  const host = document.getElementById("content"); host.innerHTML = "";
  const sub = document.createElement("div");
  sub.className = "subhead"; sub.style.cssText = "font-size:12.5px;color:var(--muted);margin:14px 4px 6px;line-height:1.5;column-span:all;-webkit-column-span:all";
  sub.textContent = cl.sub; host.appendChild(sub);
  const q = search.trim().toLowerCase();
  cl.eras.forEach((era, ei) => {
    const items = era.items.map((it, ii) => ({ it, ii })).filter(({ it, ii }) => {
      if (q && !(it.name.toLowerCase().includes(q) || (it.code || "").toLowerCase().includes(q))) return false;
      if (state.ui.hideDone && it.slots.every((s, si) => isChecked(keyFor(cl.id, it, si)))) return false;
      return true;
    });
    if (!items.length) return;
    const ep = eraProgress(cl, ei), epc = pct(ep.done, ep.total);
    const closed = state.ui.closed[cl.id + "|" + ei];
    const card = document.createElement("div"); card.className = "era" + (closed ? " closed" : "");
    const h = document.createElement("div"); h.className = "era-h";
    h.innerHTML = `<span class="chev">▼</span><h3>${era.name}</h3>
      <div class="ebar"><i style="width:${epc}%"></i></div><span class="ecount">${ep.done}/${ep.total}</span>`;
    h.onclick = () => { state.ui.closed[cl.id + "|" + ei] = !closed; saveLocal(); renderContent(); };
    card.appendChild(h);
    const body = document.createElement("div"); body.className = "era-b";
    items.forEach(({ it, ii }) => {
      const allDone = it.slots.every((s, si) => isChecked(keyFor(cl.id, it, si)));
      const row = document.createElement("div"); row.className = "row" + (allDone ? " done" : "");
      const checks = document.createElement("div"); checks.className = "checks";
      const groups = [];
      it.slots.forEach((sl, si) => {
        const g = (sl.l || "").replace(/\s*(#\d+|·\s*Kid\s*\d+|\d+)\s*$/, "").trim() || sl.l;
        let e = groups.find(x => x.n === g); if (!e) { e = { n: g, items: [] }; groups.push(e); }
        e.items.push({ sl, si });
      });
      groups.forEach(g => {
        const wrap = document.createElement("div"); wrap.className = "slotgrp";
        if (it.slots.length > 1) { const lab = document.createElement("i"); lab.className = "slotlab"; lab.textContent = g.n; wrap.appendChild(lab); }
        const bx = document.createElement("div"); bx.className = "slotboxes";
        g.items.forEach(({ sl, si }) => {
          const k = keyFor(cl.id, it, si);
          const cb = document.createElement("div");
          cb.className = "cb" + (isChecked(k) ? " ck" : "");
          cb.style.borderColor = sl.c; if (isChecked(k)) cb.style.background = sl.c;
          cb.title = sl.l; cb.innerHTML = checkSVG();
          cb.onclick = () => {
            state.checks[k] = !state.checks[k]; if (!state.checks[k]) delete state.checks[k];
            scheduleSave(); renderTabs(); renderContent(); updateOverall();
          };
          bx.appendChild(cb);
        });
        wrap.appendChild(bx); checks.appendChild(wrap);
      });
      const meta = document.createElement("div"); meta.className = "meta";
      const tags = it.tags.map(t => `<span class="tag" style="background:${t.c}">${t.t}</span>`).join("");
      const note = it.note ? `<span class="note">${it.note}</span>` : "";
      meta.innerHTML = `<div class="mname">${it.name}</div>
        <div class="msub">${it.code ? `<span class="code">${it.code}</span>` : ""}${tags}${note}</div>`;
      row.appendChild(checks); row.appendChild(meta);
      const lp = livePrices[priceKey(cl.id, it.name)];
      const liveNum = lp && (lp.ebaySold ?? lp.ebayLow ?? lp.tcg);
      if (liveNum) {
        const v = document.createElement("div"); v.className = "val"; v.style.color = "var(--lpurple)";
        v.innerHTML = "$" + Number(liveNum).toLocaleString() +
          ' <span style="font-size:8px;color:#34c27a;border:1px solid #34c27a;border-radius:6px;padding:0 3px;vertical-align:1px">LIVE</span>';
        v.title = liveTip(lp);
        row.appendChild(v);
      } else if (it.value) {
        const v = document.createElement("div"); v.className = "val" + (it.est ? " est" : "");
        v.innerHTML = valueHTML(it.value, it.est);
        if (it.value.indexOf(" / ") > -1) v.title = "MSRP / current market";
        row.appendChild(v);
      }
      body.appendChild(row);
    });
    card.appendChild(body); host.appendChild(card);
  });
  if (host.children.length <= 1) {
    const none = document.createElement("div");
    none.style.cssText = "text-align:center;color:var(--muted);padding:50px;font-size:14px";
    none.textContent = "No matches."; host.appendChild(none);
  }
}
function updateOverall() {
  const o = overall(), p = pct(o.done, o.total);
  document.getElementById("ovPct").textContent = p + "%";
  document.getElementById("ovNum").textContent = o.done + " / " + o.total;
  const arc = document.getElementById("ringArc"), C = 2 * Math.PI * 16;
  arc.setAttribute("stroke-dasharray", C);
  arc.setAttribute("stroke-dashoffset", C * (1 - o.done / (o.total || 1)));
}
function renderAll() { renderTabs(); renderContent(); updateOverall(); }

/* ---------------- drive modal ---------------- */
function openModal() {
  const info = document.getElementById("driveInfo");
  const actions = document.getElementById("modalActions");
  if (server.backend === "gist") {
    info.innerHTML = `✓ Backing up to <b>${server.label || "GitHub Gist"}</b>. Your checkmarks save to a private gist
      (<code>mtg-binder-progress.json</code>) and load on any device that opens this app.`;
    actions.innerHTML = `<button class="pbtn ghost" id="closeModal">Close</button>`;
    wireModal(); document.getElementById("driveModal").classList.add("show"); return;
  }
  if (!server.configured) {
    info.innerHTML = "🔧 <b>Setup needed:</b> add your Google OAuth credentials to a <code>.env</code> file and restart the server (see the README — about 5 minutes). Until then your progress saves locally in this browser.";
    actions.innerHTML = `<button class="pbtn ghost" id="closeModal">Got it</button>`;
  } else if (server.connected) {
    info.innerHTML = `✓ Connected as <b>${server.email || "your account"}</b>. Changes sync automatically to <code>mtg-binder-progress.json</code> in your Drive.`;
    actions.innerHTML = `<button class="pbtn ghost" id="disconnect">Disconnect</button><button class="pbtn ghost" id="closeModal">Close</button>`;
  } else {
    info.innerHTML = "🔒 Uses the least-privilege <code>drive.file</code> scope — the app can only see the one file it creates, nothing else in your Drive.";
    actions.innerHTML = `<button class="pbtn g" id="connectDrive">Connect Google Drive</button><button class="pbtn ghost" id="closeModal">Maybe later</button>`;
  }
  wireModal();
  document.getElementById("driveModal").classList.add("show");
}
function wireModal() {
  const cm = document.getElementById("closeModal"); if (cm) cm.onclick = closeModal;
  const cd = document.getElementById("connectDrive"); if (cd) cd.onclick = () => location.href = "/auth/google";
  const dc = document.getElementById("disconnect"); if (dc) dc.onclick = async () => {
    await fetch("/auth/logout", { method: "POST" }); await refreshStatus(); closeModal(); toast("Disconnected from Drive");
  };
}
function closeModal() { document.getElementById("driveModal").classList.remove("show"); }

function toast(m) { const t = document.getElementById("toast"); t.innerHTML = "✓ " + m; t.classList.add("show"); setTimeout(() => t.classList.remove("show"), 2200); }

/* ---------------- wire up ---------------- */
document.getElementById("syncBtn").onclick = openModal;
document.getElementById("drivePill").onclick = openModal;
document.getElementById("driveModal").onclick = (e) => { if (e.target.id === "driveModal") closeModal(); };
document.getElementById("exportBtn").onclick = () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
  a.download = "mtg-binder-progress.json"; a.click(); toast("Exported progress file");
};
document.getElementById("importBtn").onclick = () => document.getElementById("fileIn").click();
document.getElementById("fileIn").onchange = (e) => {
  const f = e.target.files[0]; if (!f) return; const r = new FileReader();
  r.onload = () => { try { const s = JSON.parse(r.result); if (s.checks) { state = s; migrateStateChecks(); saveLocal(); scheduleSave(); renderAll(); toast("Imported progress"); } } catch (err) { toast("Invalid file"); } };
  r.readAsText(f);
};
document.getElementById("search").oninput = (e) => { search = e.target.value; renderContent(); };
document.getElementById("hideDoneT").onclick = () => {
  state.ui.hideDone = !state.ui.hideDone;
  document.getElementById("hideDoneSw").classList.toggle("on", state.ui.hideDone); saveLocal(); renderContent();
};
document.getElementById("expandAll").onclick = () => { const cl = DATA.checklists.find(c => c.id === active); cl.eras.forEach((e, ei) => delete state.ui.closed[cl.id + "|" + ei]); saveLocal(); renderContent(); };
document.getElementById("collapseAll").onclick = () => { const cl = DATA.checklists.find(c => c.id === active); cl.eras.forEach((e, ei) => state.ui.closed[cl.id + "|" + ei] = true); saveLocal(); renderContent(); };
document.getElementById("colSel").onchange = (e) => { state.ui.cols = e.target.value; saveLocal(); applyCols(); };
document.getElementById("themeBtn").onclick = () => { state.theme = state.theme === "dark" ? "light" : "dark"; document.documentElement.setAttribute("data-theme", state.theme); saveLocal(); };

/* ---------------- live prices ---------------- */
function liveTip(lp) {
  const bits = [];
  if (lp.ebayLow != null) bits.push("eBay lowest $" + Number(lp.ebayLow).toLocaleString() +
    (lp.ebayExcluded ? ` (filtered ${lp.ebayExcluded} of ${(lp.ebayApplicable || 0) + lp.ebayExcluded}${lp.ebayFiltered === 'ai' ? ', AI' : ''})` : ""));
  if (lp.ebaySold != null) bits.push("eBay sold ~$" + Number(lp.ebaySold).toLocaleString());
  if (lp.tcg != null) bits.push("TCGplayer $" + Number(lp.tcg).toLocaleString() +
    (lp.tcgExcluded ? ` (filtered ${lp.tcgExcluded}${lp.tcgFiltered === 'ai' ? ', AI' : ''})` : ""));
  if (lp.updatedAt) bits.push("updated " + new Date(lp.updatedAt).toLocaleString());
  return bits.join("  •  ");
}
function setPriceStatus(t) { document.getElementById("priceStatus").textContent = t || ""; }
async function pullPrices() {
  try { const j = await (await fetch("/api/prices")).json(); livePrices = j.prices || {}; return j.refresh; }
  catch (e) { return null; }
}
document.getElementById("refreshPrices").onclick = async () => {
  const cl = DATA.checklists.find(c => c.id === active);
  setPriceStatus("Refreshing " + cl.title + "… eBay updates now; TCGplayer needs the extension's “Sync now”.");
  try {
    const r = await fetch("/api/prices/refresh?checklist=" + active, { method: "POST" });
    if (r.status === 409) setPriceStatus("Already refreshing — hang tight…");
    startPricePolling();
  } catch (e) { setPriceStatus("Refresh failed — is the server running?"); }
};
function startPricePolling() {
  if (pricePoll) clearInterval(pricePoll);
  let ticks = 0;
  pricePoll = setInterval(async () => {
    const refresh = await pullPrices();
    renderContent();
    ticks++;
    if (refresh && refresh.running) setPriceStatus(`Updating eBay prices… ${refresh.done}/${refresh.total}`);
    else { setPriceStatus("Prices updated. (TCGplayer fills in via the extension.)"); clearInterval(pricePoll); pricePoll = null; }
    if (ticks > 120) { clearInterval(pricePoll); pricePoll = null; }
  }, 2500);
}

/* ---------------- init ---------------- */
(async function init() {
  if (state.theme === "dark") document.documentElement.setAttribute("data-theme", "dark");
  document.getElementById("hideDoneSw").classList.toggle("on", state.ui.hideDone);
  try { DATA = await (await fetch("/api/data")).json(); }
  catch (e) { document.getElementById("content").innerHTML = "<div style='padding:50px;text-align:center;color:var(--muted)'>Couldn't load checklist data.</div>"; return; }
  LEGACY_KEYS = buildLegacyKeyMap();
  migrateStateChecks(); saveLocal();
  active = active || DATA.checklists[0].id;
  await refreshStatus();
  if (server.connected) await pullProgress();
  await pullPrices();
  if (new URLSearchParams(location.search).get("connected")) { toast("Connected to Google Drive"); history.replaceState({}, "", "/"); }
  applyCols(); renderAll();
})();
