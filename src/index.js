'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const bodyParser = require('body-parser');
const cors = require('cors');
const reqValidate = require('./module/reqValidate');
const { acquireProxy, reportProxy, poolStatus } = require('./module/proxyPool');
const metrics = require('./module/metrics');
const semaphore = require('./module/semaphore');
const auth = require('./module/auth');
const jobs = require('./module/jobs');

// A stray async CDP rejection (e.g. a page closing mid-wait) must never
// take down the whole API server. Log it loudly, keep serving.
process.on('unhandledRejection', (reason) => {
    console.error(
        'Unhandled rejection (suppressed):',
        reason && reason.message ? reason.message : reason
    );
});

const app = express();

// ---- config (all overridable via env) ----
const port = Number(process.env.PORT) || 3000;
const bodyLimit = process.env.BODY_LIMIT || '1mb';
const corsOrigin = process.env.CORS_ORIGIN || null; // null = allow all
const shutdownTimeoutMs = Number(process.env.SHUTDOWN_TIMEOUT_MS) || 10000;
const maxAttempts = Math.max(1, Number(process.env.MAX_ATTEMPTS) || 2);
const retryBackoffMs = Number(process.env.RETRY_BACKOFF_MS) || 2000;
const requestQueue = process.env.REQUEST_QUEUE === 'true';
const queueMaxWaitMs = Number(process.env.QUEUE_MAX_WAIT_MS) || 120000;
const browserMaxSolves = Number(process.env.BROWSER_MAX_SOLVES) || 0;

global.browserLength = 0;
global.browserLimit = Number(process.env.browserLimit) || 20;
global.timeOut = Number(process.env.timeOut || 60000);
global.finished = false;

let solvesSinceRestart = 0;

// ---- middleware ----
app.use(bodyParser.json({ limit: bodyLimit }));
app.use(bodyParser.urlencoded({ extended: true, limit: bodyLimit }));
app.use(cors(corsOrigin ? { origin: corsOrigin } : {}));

// tiny request logger: method path status ms
app.use((req, res, next) => {
    const t = Date.now();
    res.on('finish', () => {
        console.log(
            `${req.method} ${req.path} ${res.statusCode} ${Date.now() - t}ms`
        );
    });
    next();
});

// ---- health check (no auth, no browser needed) ----
app.get('/health', (req, res) => {
    res.json({
        status: global.browser ? 'ok' : 'starting',
        uptime: Math.floor(process.uptime()),
        activeRequests: global.browserLength,
        browserLimit: global.browserLimit,
        queued: semaphore.queued,
        jobs: jobs.jobCount(),
        proxyPool: poolStatus(),
        version: require('../package.json').version,
    });
});

// ---- prometheus metrics (no auth) ----
app.get('/metrics', (req, res) => {
    res.type('text/plain').send(metrics.renderPrometheus());
});

// ---- dashboard + history (advanced UI from solver_ultimate.js) ----
const dashboard = require('./module/dashboard');
app.get('/dashboard', (req, res) => {
    res.type('text/html').send(dashboard.dashboardHtml({ proxyPool: poolStatus }));
});
app.get('/history', (req, res) => {
    res.json(dashboard.dbHistory(parseInt(req.query.days) || 7));
});
app.get('/history/daily', (req, res) => {
    res.json(dashboard.dbDailyStats());
});

// ---- debug endpoints (from solver_ultimate.js) ----
const debugHistory = {
    tokens: [],  // { time, mode, elapsed, preview }
    errors: [],  // { time, mode, error }
    pushToken(mode, elapsed, token) {
        this.tokens.unshift({ time: new Date().toISOString(), mode, elapsed, preview: String(token).substring(0, 24) + '...' });
        if (this.tokens.length > 50) this.tokens.pop();
    },
    pushError(mode, error) {
        this.errors.unshift({ time: new Date().toISOString(), mode, error: String(error).substring(0, 200) });
        if (this.errors.length > 50) this.errors.pop();
    },
};
global.debugHistory = debugHistory;
app.get('/tokens', (req, res) => res.json(debugHistory.tokens));
app.get('/errors', (req, res) => res.json(debugHistory.errors));
app.get('/queue', (req, res) => res.json({
    queued: semaphore.queued,
    active: global.browserLength,
    limit: global.browserLimit,
}));

// ---- mode runners ----
const getSource = require('./endpoints/getSource');
const solveTurnstileMin = require('./endpoints/solveTurnstile.min');
const solveTurnstileTurbo = require('./endpoints/solveTurnstile.turbo');
const solveTurnstileMax = require('./endpoints/solveTurnstile.max');
const wafSession = require('./endpoints/wafSession');
const detect = require('./endpoints/detect');
const solveRecaptcha = require('./endpoints/solveRecaptcha');
const solveRecaptchaV3 = require('./endpoints/solveRecaptchaV3');
const solveRecaptchaEnterprise = require('./endpoints/solveRecaptchaEnterprise');
const solveRecaptchaV2 = require('./endpoints/solveRecaptchaV2');
const solveHcaptcha = require('./endpoints/solveHcaptcha');

async function runMode(data, proxy) {
    const args = { ...data, proxy };
    switch (data.mode) {
        case 'source':
            return { source: await getSource(args), code: 200 };
        case 'turnstile-min':
            if (data.turbo === true) {
                const r = await solveTurnstileTurbo(args);
                if (r && typeof r === 'object') {
                    return { code: 200, turbo: true, ...r };
                }
                return { token: r, code: 200, turbo: true };
            }
            return { token: await solveTurnstileMin(args), code: 200 };
        case 'turnstile-max':
            return { token: await solveTurnstileMax(args), code: 200 };
        case 'recaptcha':
            return { token: await solveRecaptcha(args), code: 200 };
        case 'recaptcha-v3':
            return { token: await solveRecaptchaV3(args), code: 200 };
        case 'recaptcha-enterprise':
            return { token: await solveRecaptchaEnterprise(args), code: 200 };
        case 'recaptcha-v2':
            return { token: await solveRecaptchaV2(args), code: 200 };
        case 'hcaptcha':
            return { token: await solveHcaptcha(args), code: 200 };
        case 'waf-session':
            return { ...(await wafSession(args)), code: 200 };
        case 'detect':
            return { ...(await detect(args)), code: 200 };
        default:
            throw new Error('Bad Request');
    }
}

// Every attempt solves fresh — a new token/session is produced every time,
// never served from a cache. On failure the next attempt uses a fresh
// browser context and (when a pool is configured) a different proxy.
async function runWithRetry(data) {
    let lastErr;
    for (let n = 1; n <= maxAttempts; n++) {
        const { proxy, entry } = acquireProxy(data.proxy);
        try {
            const out = await runMode(data, proxy);
            reportProxy(entry, true);
            return { out, attempts: n };
        } catch (err) {
            reportProxy(entry, false);
            if (entry) metrics.proxyFailed();
            lastErr = err;
            if (n < maxAttempts) {
                metrics.retried();
                await new Promise((r) => setTimeout(r, retryBackoffMs * n));
            }
        }
    }
    throw lastErr;
}

function saveDebugShot(mode, base64) {
    try {
        const dir = path.join(__dirname, '..', 'debug');
        fs.mkdirSync(dir, { recursive: true });
        const fp = path.join(dir, `fail_${mode}_${Date.now()}.png`);
        fs.writeFileSync(fp, Buffer.from(base64, 'base64'));
        return fp;
    } catch (e) {
        return null;
    }
}

function errorBody(data, err) {
    const body = { code: 500, message: err.message };
    if (err.debugScreenshot) {
        body.screenshot = err.debugScreenshot;
        const fp = saveDebugShot(data.mode, err.debugScreenshot);
        if (fp) body.screenshotFile = fp;
    }
    return body;
}

// Executes one request inside an already-held browser slot.
async function executeRequest(data) {
    metrics.requestStarted();
    const t0 = Date.now();
    try {
        const { out, attempts } = await runWithRetry(data);
        const elapsed = Date.now() - t0;
        metrics.requestFinished(data.mode, true, elapsed);
        // Dashboard + SQLite history
        try {
            dashboard.recordSolve({
                mode: data.mode,
                elapsedMs: elapsed,
                ok: true,
                warm: out.warm,
                token: out.token,
            });
        } catch (e) {}
        return { ok: true, out, attempts };
    } catch (err) {
        const elapsed = Date.now() - t0;
        metrics.requestFinished(data.mode, false, elapsed);
        try {
            dashboard.recordSolve({
                mode: data.mode,
                elapsedMs: elapsed,
                ok: false,
                warm: undefined,
            });
        } catch (e) {}
        return { ok: false, err };
    }
}

// Restart the browser every N solves to fight memory leaks and
// fingerprint buildup. Only restarts when idle so live requests survive.
function maybeRestartBrowser() {
    if (
        browserMaxSolves > 0 &&
        solvesSinceRestart >= browserMaxSolves &&
        global.browserLength === 0 &&
        global.browser &&
        process.env.SKIP_LAUNCH != 'true'
    ) {
        solvesSinceRestart = 0;
        console.log(
            `Browser reached ${browserMaxSolves} solves — restarting...`
        );
        global.browser.close().catch(() => {});
    }
}

function afterRequest(tokenEntry) {
    semaphore.release();
    if (tokenEntry) auth.tokenEnd(tokenEntry);
    solvesSinceRestart += 1;
    maybeRestartBrowser();
}

function fireWebhook(job) {
    const payload = JSON.stringify({
        jobId: job.id,
        status: job.status,
        result: job.result,
        error: job.error,
        screenshot: job.screenshot,
        attempts: job.attempts,
    });
    fetch(job.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        signal: AbortSignal.timeout(15000),
    }).catch((e) => {
        console.log(`Webhook for ${job.id} failed: ${e.message}`);
    });
}

// Background worker for async jobs. Holds a browser slot (waiting up to
// queueMaxWaitMs), runs the retries, stores the result, fires the webhook.
async function processJob(job, tokenEntry) {
    job.status = 'running';
    const got = await semaphore.acquire(queueMaxWaitMs);
    if (!got) {
        job.status = 'error';
        job.error = 'Timed out waiting for a browser slot';
    } else {
        try {
            const r = await executeRequest(job.data);
            if (r.ok) {
                job.status = 'done';
                job.result = { ...r.out, attempts: r.attempts };
                job.attempts = r.attempts;
            } else {
                job.status = 'error';
                job.error = r.err.message;
                if (r.err.debugScreenshot) job.screenshot = r.err.debugScreenshot;
            }
        } finally {
            afterRequest(tokenEntry);
        }
    }
    if (!got && tokenEntry) auth.tokenEnd(tokenEntry);
    if (job.webhookUrl) fireWebhook(job);
    jobs.scheduleCleanup(job.id);
}

function browserReady() {
    return process.env.SKIP_LAUNCH == 'true' || global.browser;
}

// ---- main endpoint ----
app.post('/cf-clearance-scraper', async (req, res) => {
    const data = req.body || {};

    const check = reqValidate(data);
    if (check !== true) {
        return res
            .status(400)
            .json({ code: 400, message: 'Bad Request', schema: check });
    }

    const { ok, entry } = auth.verify(data.authToken);
    if (!ok) {
        return res.status(401).json({ code: 401, message: 'Unauthorized' });
    }
    if (!auth.tokenStart(entry)) {
        return res.status(429).json({
            code: 429,
            message: 'Token concurrency limit reached',
        });
    }

    if (!browserReady()) {
        auth.tokenEnd(entry);
        return res.status(500).json({
            code: 500,
            message:
                'The scanner is not ready yet. Please try again a little later.',
        });
    }

    // async job mode — return immediately, poll GET /jobs/:id
    if (data.async === true) {
        const job = jobs.createJob(data);
        processJob(job, entry); // background, not awaited
        return res.status(202).json({
            code: 202,
            jobId: job.id,
            status: 'queued',
        });
    }

    const waitMs = requestQueue ? queueMaxWaitMs : 0;
    const got = await semaphore.acquire(waitMs);
    if (!got) {
        auth.tokenEnd(entry);
        const code = requestQueue ? 503 : 429;
        return res.status(code).json({
            code,
            message: requestQueue
                ? 'Timed out waiting for a browser slot'
                : 'Too Many Requests',
        });
    }

    try {
        const t0 = Date.now();
        const r = await executeRequest(data);
        const elapsed = Date.now() - t0;
        if (r.ok) {
            // Track successful token (from solver_ultimate.js)
            const tok = r.out && (r.out.token || (r.out.result && r.out.result.token));
            if (tok && global.debugHistory) global.debugHistory.pushToken(data.mode, elapsed, tok);
            res.status(r.out.code ?? 500).send({ ...r.out, attempts: r.attempts });
        } else {
            if (global.debugHistory) global.debugHistory.pushError(data.mode, r.err && r.err.message);
            res.status(500).json(errorBody(data, r.err));
        }
    } finally {
        afterRequest(entry);
    }
});

// ---- async job status (job ids are unguessable, no auth) ----
app.get('/jobs/:id', (req, res) => {
    const job = jobs.getJob(req.params.id);
    if (!job) {
        return res.status(404).json({ code: 404, message: 'Job not found' });
    }
    res.json({
        code: 200,
        jobId: job.id,
        status: job.status,
        result: job.result,
        error: job.error,
        screenshot: job.screenshot,
        attempts: job.attempts,
        createdAt: job.createdAt,
    });
});

// ---- bulk solve: N tokens for the same (url, mode, siteKey) ----
// Body: { url, mode, siteKey, count (1-10), ...same options as /cf-clearance-scraper }
// Solved sequentially to avoid browser overload. Each token is fresh.
app.post('/bulk', async (req, res) => {
    const data = req.body || {};
    const count = Math.min(Math.max(parseInt(data.count) || 1, 1), 10);

    const check = reqValidate(data);
    if (check !== true) {
        return res
            .status(400)
            .json({ code: 400, message: 'Bad Request', schema: check });
    }

    const { ok, entry } = auth.verify(data.authToken);
    if (!ok) {
        return res.status(401).json({ code: 401, message: 'Unauthorized' });
    }

    if (!browserReady()) {
        return res.status(500).json({
            code: 500,
            message: 'The scanner is not ready yet. Please try again a little later.',
        });
    }

    const results = [];
    for (let i = 0; i < count; i++) {
        if (!auth.tokenStart(entry)) {
            results.push({ ok: false, error: 'Token concurrency limit reached' });
            continue;
        }
        try {
            const r = await executeRequest(data);
            if (r.ok) {
                results.push({ ok: true, ...r.out, attempts: r.attempts });
            } else {
                results.push({ ok: false, error: r.err && r.err.message ? r.err.message : String(r.err) });
            }
        } finally {
            afterRequest(entry);
        }
        // Small breather between solves
        if (i < count - 1) await new Promise((r) => setTimeout(r, 1000));
    }

    const succeeded = results.filter((x) => x.ok).length;
    res.json({ code: 200, total: count, succeeded, failed: count - succeeded, results });
});

app.use((req, res) => {
    res.status(404).json({ code: 404, message: 'Not Found' });
});

// ---- boot ----
let server = null;
if (process.env.NODE_ENV !== 'development') {
    server = app.listen(port, () => {
        console.log(`Server running on port ${port}`);
    });
    try {
        server.timeout = global.timeOut;
    } catch (e) {}
}

if (process.env.SKIP_LAUNCH != 'true') require('./module/createBrowser');

// ---- graceful shutdown ----
function shutdown(signal) {
    if (global.finished) return;
    global.finished = true;
    console.log(`Received ${signal} — shutting down...`);
    const force = setTimeout(() => process.exit(0), shutdownTimeoutMs);
    force.unref();
    (async () => {
        try {
            if (global.browser) await global.browser.close().catch(() => {});
            if (server) {
                await new Promise((resolve) => server.close(resolve));
            }
        } finally {
            clearTimeout(force);
            process.exit(0);
        }
    })();
}

if (server) {
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
}

if (process.env.NODE_ENV == 'development') module.exports = app;
