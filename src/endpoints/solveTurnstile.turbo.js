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
 *
 * Returns { token, warm, warmError, turboMs } — runMode spreads this.
 */
async function solveTurnstileTurbo({ url, proxy, headers, debug, timeout, siteKey }) {
    if (!url) throw new Error('Missing url parameter');
    if (!siteKey) throw new Error('Missing siteKey parameter');

    const ms = resolveTimeout(timeout);
    const t0 = Date.now();
    let acquired = null;

    try {
        return await withTimeout(
            (async () => {
                const tA0 = Date.now();
                acquired = await warmPool.acquire(url, proxy);
                const acquireMs = Date.now() - tA0;
                const warmError = acquired && acquired.warmError ? acquired.warmError : null;

                if (!acquired || !acquired.slot) {
                    // Pool exhausted / warmup failed — normal fresh-context solve
                    console.log(`[turbo] fallback (no warm slot): ${warmError || 'n/a'}`);
                    const tS0 = Date.now();
                    const tok = await solveInvisibleWidget({
                        url, proxy, headers, debug, timeout,
                        siteKey, template: 'fakePage.html', label: 'solveTurnstileTurbo/fallback',
                    });
                    return {
                        token: tok, warm: false, warmError,
                        turboMs: { acquire: acquireMs, solve: Date.now() - tS0, total: Date.now() - t0 },
                    };
                }
                const { slot, release } = acquired;
                try {
                    const tS0 = Date.now();
                    console.log(`[turbo] warm solve start (acquire ${acquireMs}ms)`);
                    const tok = await slot.page.evaluate(
                        (key, tmo) => window.__turboSolve(key, tmo),
                        siteKey,
                        30000
                    );
                    if (!tok || tok.length < 10) throw new Error('Failed to get token');
                    console.log(`[turbo] warm solve ok in ${Date.now() - tS0}ms`);
                    return {
                        token: tok, warm: true, warmError: null,
                        turboMs: { acquire: acquireMs, solve: Date.now() - tS0, total: Date.now() - t0 },
                    };
                } catch (e) {
                    const werr = e && e.message ? String(e.message).slice(0, 200) : String(e);
                    console.log(`[turbo] warm solve failed: ${werr} — falling back`);
                    await warmPool.invalidate(slot, url, proxy).catch(() => {});
                    // Warm solve failed — one fresh-context attempt
                    const tS0 = Date.now();
                    const tok = await solveInvisibleWidget({
                        url, proxy, headers, debug, timeout,
                        siteKey, template: 'fakePage.html', label: 'solveTurnstileTurbo/retry',
                    });
                    return {
                        token: tok, warm: false, warmError: werr,
                        turboMs: { acquire: acquireMs, solve: Date.now() - tS0, total: Date.now() - t0 },
                    };
                } finally {
                    release();
                }
            })(),
            ms,
            'solveTurnstileTurbo'
        );
    } catch (err) {
        if (debug && acquired && acquired.slot) await attachDebugShot(acquired.slot.page, err);
        throw err;
    }
}

module.exports = solveTurnstileTurbo;
