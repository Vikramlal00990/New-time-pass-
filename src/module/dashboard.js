'use strict';

// Advanced dashboard + SQLite history for cf-clearance-scraper.
// Adapted from solver_ultimate.js concepts.

const fs = require('fs');
const path = require('path');

// ---- SQLite (optional) ----
let db = null;
try {
    const Database = require('better-sqlite3');
    const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'solver_stats.db');
    db = new Database(dbPath);
    db.exec(`
        CREATE TABLE IF NOT EXISTS solves (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            time TEXT,
            mode TEXT,
            elapsed INTEGER,
            ok INTEGER,
            warm INTEGER,
            error TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_solves_time ON solves(time);
    `);
    // Prune older than 7 days on startup
    try {
        db.exec(`DELETE FROM solves WHERE time < datetime('now', '-7 days')`);
    } catch (e) {}
    console.log('[dashboard] SQLite history enabled at', dbPath);
} catch (e) {
    console.log('[dashboard] better-sqlite3 not available — history disabled');
}

function dbRecord({ mode, elapsedMs, ok, warm, error }) {
    if (!db) return;
    try {
        db.prepare(
            'INSERT INTO solves (time, mode, elapsed, ok, warm, error) VALUES (datetime(\'now\'), ?, ?, ?, ?, ?)'
        ).run(mode, Math.round(elapsedMs), ok ? 1 : 0, warm ? 1 : 0, (error || '').substring(0, 500));
    } catch (e) {}
}

function dbHistory(days = 7) {
    if (!db) return [];
    try {
        return db.prepare(
            `SELECT * FROM solves WHERE time >= datetime('now', '-' || ? || ' days') ORDER BY id DESC LIMIT 500`
        ).all(days);
    } catch (e) { return []; }
}

function dbDailyStats() {
    if (!db) return [];
    try {
        return db.prepare(`
            SELECT date(time) as day, COUNT(*) as total,
                   SUM(ok) as success, AVG(elapsed) as avgMs,
                   SUM(warm) as warmHits
            FROM solves
            WHERE time >= datetime('now', '-7 days')
            GROUP BY date(time) ORDER BY day DESC
        `).all();
    } catch (e) { return []; }
}

// ---- In-memory stats ----
const stats = {
    total: 0,
    success: 0,
    failed: 0,
    times: [],
    byMode: {},
    warmHits: 0,
    warmMisses: 0,
    recentTokens: [],
    logs: [],
    startTime: Date.now(),
};

function addLog(type, msg) {
    const entry = { time: new Date().toISOString(), type, msg: String(msg).substring(0, 300) };
    stats.logs.unshift(entry);
    if (stats.logs.length > 200) stats.logs.pop();
}

function recordSolve({ mode, elapsedMs, ok, warm, token }) {
    stats.total++;
    if (ok) stats.success++; else stats.failed++;
    stats.times.push(elapsedMs);
    if (stats.times.length > 500) stats.times.shift();
    stats.byMode[mode] = (stats.byMode[mode] || 0) + 1;
    if (warm === true) stats.warmHits++;
    else if (warm === false) stats.warmMisses++;

    if (ok && token) {
        stats.recentTokens.unshift({
            time: new Date().toISOString(),
            mode,
            elapsed: Math.round(elapsedMs),
            preview: token.substring(0, 24) + '...',
            len: token.length,
        });
        if (stats.recentTokens.length > 30) stats.recentTokens.pop();
    }

    dbRecord({ mode, elapsedMs, ok, warm, error: ok ? '' : 'failed' });
    addLog(ok ? 'SUCCESS' : 'ERROR', `${mode} ${Math.round(elapsedMs)}ms warm=${warm}`);
}

// ---- Dashboard HTML ----
function dashboardHtml(deps) {
    const { proxyPool, warmPool, metrics } = deps;
    const avg = stats.times.length
        ? (stats.times.reduce((a, b) => a + b, 0) / stats.times.length).toFixed(0)
        : '—';
    const uptime = Math.round((Date.now() - stats.startTime) / 1000);
    const rate = stats.total ? ((stats.success / stats.total) * 100).toFixed(1) : '—';
    const best = stats.times.length ? Math.min(...stats.times).toFixed(0) : '—';
    const worst = stats.times.length ? Math.max(...stats.times).toFixed(0) : '—';
    const warmRate = (stats.warmHits + stats.warmMisses)
        ? ((stats.warmHits / (stats.warmHits + stats.warmMisses)) * 100).toFixed(0)
        : '—';
    const daily = dbDailyStats();

    const modeRows = Object.entries(stats.byMode)
        .map(([m, c]) => `<div class="prog-row"><div class="prog-label">${m}</div><div class="prog-track"><div class="prog-fill" style="width:${Math.min(100, (c / Math.max(1, stats.total)) * 100)}%;background:var(--blue)"></div></div><div class="prog-count">${c}</div></div>`)
        .join('');

    const tokenRows = stats.recentTokens.map(t => `
        <div class="token-row">
            <span class="token-time">${t.time.substring(11, 19)}</span>
            <span class="token-type" style="background:#6c8ef520;color:#6c8ef5">${t.mode}</span>
            <span class="token-elapsed">${t.elapsed}ms</span>
            <span class="token-val">${t.preview}</span>
        </div>`).join('');

    const logRows = stats.logs.slice(0, 50).map(l => `
        <div class="log-row">
            <span class="log-time">${l.time.substring(11, 19)}</span>
            <span class="log-${l.type}">${l.type}</span>
            <span class="log-msg">${l.msg}</span>
        </div>`).join('');

    const dailyRows = daily.map(d => `
        <div class="daily-row">
            <span class="daily-day">${d.day}</span>
            <span style="min-width:60px">${d.success}/${d.total}</span>
            <div class="daily-bar-wrap"><div class="daily-bar" style="width:${d.total ? (d.success / d.total) * 100 : 0}%"></div></div>
            <span style="color:var(--muted)">${Math.round(d.avgMs || 0)}ms</span>
        </div>`).join('');

    let poolInfo = 'n/a';
    try {
        const ps = proxyPool ? proxyPool() : null;
        if (ps) poolInfo = `${ps.available}/${ps.size} available`;
    } catch (e) {}

    return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<title>⚡ CF Solver v3 — Dashboard</title>
<meta http-equiv="refresh" content="5">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{--bg:#0d0d10;--surface:#13131a;--surface2:#1a1a24;--border:#2a2a3a;--text:#e0e0f0;--muted:#606080;--green:#3ddc84;--red:#ff5c5c;--blue:#6c8ef5;--orange:#f5a623;--teal:#50e3c2}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,sans-serif;background:var(--bg);color:var(--text);min-height:100vh;padding:16px}
.header{display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;flex-wrap:wrap;gap:10px}
.logo{font-family:monospace;font-size:1.1rem;font-weight:600}.logo span{color:var(--green)}
.pill{font-family:monospace;font-size:.62rem;padding:3px 9px;border-radius:20px}
.pill-green{background:#3ddc8420;color:var(--green);border:1px solid #3ddc8440}
.status-row{font-family:monospace;font-size:.65rem;color:var(--muted);display:flex;gap:14px;flex-wrap:wrap}
.status-row b{color:var(--text)}
.grid-6{display:grid;grid-template-columns:repeat(6,1fr);gap:8px;margin-bottom:12px}
@media(max-width:700px){.grid-6{grid-template-columns:repeat(3,1fr)}}
.card{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:12px 10px;text-align:center}
.card-val{font-family:monospace;font-size:1.3rem;font-weight:600;margin-bottom:5px;color:var(--accent,var(--text))}
.card-lbl{font-size:.58rem;color:var(--muted);letter-spacing:.12em;text-transform:uppercase}
.section{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:14px;margin-bottom:12px}
.section-title{font-family:monospace;font-size:.65rem;color:var(--muted);letter-spacing:.14em;text-transform:uppercase;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid var(--border)}
.prog-row{display:flex;align-items:center;gap:10px;margin-bottom:8px}
.prog-label{font-family:monospace;font-size:.62rem;min-width:120px;color:var(--muted)}
.prog-track{flex:1;height:6px;background:var(--surface2);border-radius:4px;overflow:hidden}
.prog-fill{height:100%;border-radius:4px}
.prog-count{font-family:monospace;font-size:.62rem;min-width:22px;text-align:right}
.log-row{display:flex;gap:8px;padding:4px 0;border-bottom:1px solid #ffffff08;font-family:monospace;font-size:.63rem}
.log-time{color:var(--muted);min-width:62px}.log-SUCCESS{color:var(--green);min-width:66px}.log-ERROR{color:var(--red);min-width:66px}.log-INFO{color:var(--blue);min-width:66px}
.log-msg{color:#9090b0;word-break:break-all}
.token-row{display:flex;gap:8px;padding:5px 0;border-bottom:1px solid #ffffff08;font-family:monospace;font-size:.63rem;align-items:center}
.token-time{color:var(--muted);min-width:62px}.token-type{font-size:.6rem;padding:1px 7px;border-radius:10px;min-width:90px;text-align:center}
.token-elapsed{color:var(--orange);min-width:52px;text-align:right}.token-val{color:#7070a0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}
.daily-row{display:flex;align-items:center;gap:10px;padding:5px 0;border-bottom:1px solid #ffffff08;font-family:monospace;font-size:.62rem}
.daily-day{color:var(--muted);min-width:90px}.daily-bar-wrap{flex:1;height:5px;background:var(--surface2);border-radius:3px;overflow:hidden}
.daily-bar{height:100%;background:var(--green);border-radius:3px}
.btn{font-family:monospace;font-size:.65rem;padding:7px 12px;border-radius:6px;border:1px solid var(--border);background:var(--surface2);color:var(--text);cursor:pointer;margin:2px}
.btn:hover{border-color:var(--green)}
input,select{font-family:monospace;font-size:.7rem;padding:7px;border-radius:6px;border:1px solid var(--border);background:var(--surface2);color:var(--text);margin:2px}
.test-form{display:flex;flex-wrap:wrap;gap:4px;align-items:center}
</style></head><body>
<div class="header">
<div><div class="logo">⚡ CF-SOLVER <span>v3</span></div>
<div class="status-row"><span>UPTIME <b>${uptime}s</b></span><span>PROXY POOL <b>${poolInfo}</b></span><span>DB <b>${db ? 'ON' : 'OFF'}</b></span></div></div>
<div><span class="pill pill-green">● LIVE</span></div></div>

<div class="grid-6">
<div class="card" style="--accent:var(--blue)"><div class="card-val">${stats.total}</div><div class="card-lbl">Total Solves</div></div>
<div class="card" style="--accent:var(--green)"><div class="card-val">${rate}%</div><div class="card-lbl">Success Rate</div></div>
<div class="card" style="--accent:var(--orange)"><div class="card-val">${avg}ms</div><div class="card-lbl">Avg Time</div></div>
<div class="card" style="--accent:var(--teal)"><div class="card-val">${best}ms</div><div class="card-lbl">Best Time</div></div>
<div class="card" style="--accent:var(--red)"><div class="card-val">${worst}ms</div><div class="card-lbl">Worst Time</div></div>
<div class="card" style="--accent:var(--green)"><div class="card-val">${warmRate}%</div><div class="card-lbl">Turbo Hit Rate</div></div>
</div>

<div class="section"><div class="section-title">🧪 Live Test</div>
<div class="test-form">
<select id="tMode"><option value="turnstile-min">turnstile-min</option><option value="turnstile-max">turnstile-max</option><option value="detect">detect</option><option value="source">source</option><option value="recaptcha-v3">recaptcha-v3</option><option value="recaptcha-enterprise">recaptcha-enterprise</option><option value="recaptcha-v2">recaptcha-v2</option></select>
<input id="tKey" placeholder="siteKey" size="28" value="1x00000000000000000000AA">
<input id="tUrl" placeholder="url" size="32" value="https://turnstile.zeroclover.io/">
<label style="font-size:.7rem"><input type="checkbox" id="tTurbo" checked> turbo</label>
<button class="btn" onclick="runTest()">▶ Solve</button>
<span id="tOut" style="font-family:monospace;font-size:.7rem;color:var(--muted)"></span>
</div>
<script>
async function runTest(){
  const out=document.getElementById('tOut'); out.textContent='solving...';
  try{
    const r=await fetch('/cf-clearance-scraper',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({mode:document.getElementById('tMode').value,siteKey:document.getElementById('tKey').value,url:document.getElementById('tUrl').value,turbo:document.getElementById('tTurbo').checked})});
    const j=await r.json();
    out.textContent=j.success?('✅ '+(j.turboMs?j.turboMs.total+'ms':'')+' token:'+(j.token||'').substring(0,20)+'... warm='+j.warm):('❌ '+(j.error||'failed'));
  }catch(e){out.textContent='error: '+e.message}
}
</script></div>

<div class="section"><div class="section-title">📊 Solves by Mode</div>${modeRows || '<div style="color:var(--muted);font-size:.7rem">No data yet</div>'}</div>

<div class="section"><div class="section-title">🎫 Recent Tokens</div>${tokenRows || '<div style="color:var(--muted);font-size:.7rem">No tokens yet</div>'}</div>

<div class="section"><div class="section-title">📅 7-Day History</div>${dailyRows || '<div style="color:var(--muted);font-size:.7rem">DB disabled or no data</div>'}</div>

<div class="section"><div class="section-title">📝 Live Logs</div>${logRows || '<div style="color:var(--muted);font-size:.7rem">No logs yet</div>'}</div>

<div style="text-align:center;color:var(--muted);font-size:.6rem;font-family:monospace;margin-top:12px">
<button class="btn" onclick="fetch('/history').then(r=>r.json()).then(d=>alert(JSON.stringify(d.slice(0,5),null,2)))">📊 History JSON</button>
<button class="btn" onclick="fetch('/metrics').then(r=>r.text()).then(t=>alert(t.substring(0,800)))">📈 Metrics</button>
</div>
</body></html>`;
}

module.exports = { recordSolve, addLog, dashboardHtml, dbHistory, dbDailyStats, stats };
