'use strict';

const withTimeout = require('../module/timeout');
const { resolveTimeout, attachDebugShot } = require('../module/browserContext');
const { solveInvisibleWidget } = require('../module/widgetSolver');
const warmPool = require('../module/warmPool');

/**
 * TURBO Turnstile solve.
 *
 * Uses a warm page (api.js preloaded, Cloudflare session live) and renders
 * a brand-new widget per request, harvesting a freshly issued token.
 * Falls back to a normal fresh-context solve when no warm page is free
 * or the warm solve fails — turbo never fails where normal would succeed.
 *
 * Every token is freshly issued; only the page/session is reused.
 */
async function solveTurnstileTurbo({ url, proxy, headers, debug, timeout, siteKey }) {
    if (!url) throw new Error('Missing url parameter');
    if (!siteKey) throw new Error('Missing siteKey parameter');

    const ms = resolveTimeout(timeout);
    const t0 = Date.now();
    let acquired = null;
    let warmUsed = false;
    let warmError = null;

    try {
        const token = await withTimeout(
            (async () => {
                const tA0 = Date.now();
                acquired = await warmPool.acquire(url, proxy);
                const acquireMs = Date.now() - tA0;
                warmError = acquired && acquired.warmError ? acquired.warmError : null;

                if (!acquired || !acquired.slot) {
                    // Pool exhausted / warmup failed — normal fresh-context solve
                    const tS0 = Date.now();
                    const r = await solveInvisibleWidget({
                        url, proxy, headers, debug, timeout,
                        siteKey, template: 'fakePage.html', label: 'solveTurnstileTurbo/fallback',
                    });
                    r.turbo = true;
                    r.warm = false;
                    r.warmError = warmError;
                    r.turboMs = { acquire: acquireMs, solve: Date.now() - tS0, total: Date.now() - t0 };
                    return r;
                }
                const { slot, release } = acquired;
                warmUsed = true;
                try {
                    const tS0 = Date.now();
                    console.log(`[turbo] warm solve start (acquire ${acquireMs}ms)`);
                    const tok = await slot.page.evaluate(
                        (key, tmo) => window.__turboSolve(key, tmo),
                        siteKey,
                        30000
                    );
                    if (!tok || tok.length < 10) throw new Error('Failed to get token');
                    return {
                        token: tok, code: 200, turbo: true, warm: true,
                        turboMs: { acquire: acquireMs, solve: Date.now() - tS0, total: Date.now() - t0 },
                    };
                } catch (e) {
                    warmError = e && e.message ? String(e.message).slice(0, 200) : String(e);
                    await warmPool.invalidate(slot, url, proxy).catch(() => {});
                    // Warm solve failed — one fresh-context attempt
                    const tS0 = Date.now();
                    const r = await solveInvisibleWidget({
                        url, proxy, headers, debug, timeout,
                        siteKey, template: 'fakePage.html', label: 'solveTurnstileTurbo/retry',
                    });
                    r.turbo = true;
                    r.warm = false;
                    r.warmError = warmError;
                    r.turboMs = { acquire: acquireMs, solve: Date.now() - tS0, total: Date.now() - t0 };
                    return r;
                } finally {
                    release();
                }
            })(),
            ms,
            'solveTurnstileTurbo'
        );
        return token;
    } catch (err) {
        if (debug && acquired && acquired.slot) await attachDebugShot(acquired.slot.page, err);
        throw err;
    }
}

module.exports = solveTurnstileTurbo;
