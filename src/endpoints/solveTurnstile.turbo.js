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
    let acquired = null;

    try {
        return await withTimeout(
            (async () => {
                acquired = await warmPool.acquire(url, proxy);
                if (!acquired) {
                    // Pool exhausted — normal fresh-context solve
                    return solveInvisibleWidget({
                        url, proxy, headers, debug, timeout,
                        siteKey, template: 'fakePage.html', label: 'solveTurnstileTurbo/fallback',
                    });
                }
                const { slot, release } = acquired;
                try {
                    const token = await slot.page.evaluate(
                        (key, tmo) => window.__turboSolve(key, tmo),
                        siteKey,
                        Math.max(10000, ms - 5000)
                    );
                    if (!token || token.length < 10) throw new Error('Failed to get token');
                    return token;
                } catch (e) {
                    await warmPool.invalidate(slot, url, proxy).catch(() => {});
                    // Warm solve failed — one fresh-context attempt
                    return solveInvisibleWidget({
                        url, proxy, headers, debug, timeout,
                        siteKey, template: 'fakePage.html', label: 'solveTurnstileTurbo/retry',
                    });
                } finally {
                    release();
                }
            })(),
            ms,
            'solveTurnstileTurbo'
        );
    } catch (err) {
        if (debug && acquired) await attachDebugShot(acquired.slot.page, err);
        throw err;
    }
}

module.exports = solveTurnstileTurbo;
