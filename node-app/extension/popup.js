const sw = document.getElementById('sw');
const server = document.getElementById('server');
const stat = document.getElementById('stat');
const KEY_FIELDS = ['EBAY_ENV', 'EBAY_CLIENT_ID', 'EBAY_CLIENT_SECRET', 'AI_PROVIDER', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY'];

function fmtAgo(t) { if (!t) return 'never'; const s = Math.floor((Date.now() - t) / 1000); if (s < 60) return s + 's ago'; if (s < 3600) return Math.floor(s / 60) + 'm ago'; return Math.floor(s / 3600) + 'h ago'; }
function serverUrl() { return (server.value || 'http://localhost:3000').trim().replace(/\/+$/, ''); }

async function refreshStatus() {
  chrome.runtime.sendMessage({ type: 'status' }, (st) => {
    if (!st) return;
    sw.classList.toggle('on', !!st.enabled);
    if (document.activeElement !== server) server.value = st.serverUrl || 'http://localhost:3000';
    const dot = st.serverOk ? 'ok' : 'bad';
    const pend = st.serverOk ? `${st.pending ?? 0} job(s) queued` : 'server not reachable';
    stat.innerHTML = `<span class="dot ${dot}"></span>${pend}<br>Last sync: ${fmtAgo(st.lastSync)} (${st.lastCount || 0} priced)`;
  });
}

sw.onclick = async () => {
  const c = await chrome.storage.local.get({ enabled: false });
  await chrome.storage.local.set({ enabled: !c.enabled });
  refreshStatus();
};
server.onchange = async () => {
  await chrome.storage.local.set({ serverUrl: serverUrl() });
  refreshStatus(); loadKeyStatus();
};
document.getElementById('sync').onclick = () => {
  stat.innerHTML = '<span class="dot"></span>Syncing… (opens TCGplayer tabs briefly)';
  chrome.runtime.sendMessage({ type: 'syncNow' }, (r) => {
    stat.innerHTML = r && r.ok ? `<span class="dot ok"></span>Done — priced ${r.processed} item(s)` : '<span class="dot bad"></span>Sync failed';
    setTimeout(refreshStatus, 1500);
  });
};

/* ---- API keys panel ---- */
const keysToggle = document.getElementById('keysToggle');
const keysPanel = document.getElementById('keysPanel');
const keysChevron = document.getElementById('keysChevron');
keysToggle.onclick = () => {
  const open = keysPanel.classList.toggle('open');
  keysChevron.textContent = open ? '▾' : '▸';
  if (open) loadKeyStatus();
};

async function loadKeyStatus() {
  const ks = document.getElementById('ksstat');
  try {
    const r = await fetch(serverUrl() + '/api/config');
    const j = await r.json();
    const k = j.keys || {};
    ks.innerHTML =
      `eBay: ${j.ebayConfigured ? '✓ configured' : '— not set'}` +
      (k.EBAY_ENV ? ` (${k.EBAY_ENV})` : '') +
      `<br>AI: ${j.aiConfigured ? '✓ ' + (j.aiProvider || '') + ' / ' + (j.aiModel || '') : '— not set'}`;
  } catch (e) {
    ks.innerHTML = '<span style="color:#e05c5c">Can\'t reach server — start it, then reopen.</span>';
  }
}

document.getElementById('saveKeys').onclick = async () => {
  const ks = document.getElementById('ksstat');
  const payload = {};
  KEY_FIELDS.forEach((f) => { const v = document.getElementById(f).value.trim(); if (v) payload[f] = v; });
  if (!Object.keys(payload).length) { ks.textContent = 'Nothing to save — fill in a field first.'; return; }
  ks.textContent = 'Saving…';
  try {
    const r = await fetch(serverUrl() + '/api/config', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    const j = await r.json();
    if (j.ok) {
      // clear secret fields from the form so they aren't left lying around
      ['EBAY_CLIENT_SECRET', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY'].forEach((f) => { document.getElementById(f).value = ''; });
      ks.innerHTML = `<span style="color:#34c27a">Saved ${j.changed} value(s) to your server.</span>`;
      setTimeout(loadKeyStatus, 600);
    } else ks.textContent = 'Save failed.';
  } catch (e) { ks.innerHTML = '<span style="color:#e05c5c">Save failed — is the server running?</span>'; }
};

refreshStatus();
setInterval(refreshStatus, 3000);
