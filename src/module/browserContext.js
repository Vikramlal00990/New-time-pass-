'use strict';

const { buildProxyServer, applyProxyAuth } = require('./proxy');
const { applyFingerprint } = require('./fingerprint');

// Resource types that never matter for a Cloudflare challenge / page
// source grab. Aborting them cuts page load time dramatically.
const BLOCKED_TYPES = new Set(['image', 'font', 'media']);

/**
 * Attach the speed interceptor to a page: heavy resources are aborted,
 * everything else continues untouched.
 */
async function attachSpeedInterceptor(page) {
    await page.setRequestInterception(true);
    page.on('request', (request) => {
        try {
            if (BLOCKED_TYPES.has(request.resourceType())) {
                request.abort();
            } else {
                request.continue();
            }
        } catch (e) {
            // page may already be closed — ignore
        }
    });
}

/**
 * Create an isolated incognito context. Caller MUST close it.
 */
async function newContext(proxy) {
    const context = await global.browser
        .createBrowserContext({
            // https://pptr.dev/api/puppeteer.browsercontextoptions
            proxyServer: buildProxyServer(proxy),
        })
        .catch(() => null);
    if (!context) throw new Error('Failed to create browser context');
    return context;
}

/**
 * Apply proxy auth, custom headers and fingerprint rotation to a page.
 */
async function setupPage(page, proxy, opts = {}) {
    await applyProxyAuth(page, proxy);
    if (opts.headers) {
        await page.setExtraHTTPHeaders(opts.headers);
    }
    await applyFingerprint(page);
}

/**
 * Create an isolated incognito context + page, wired for speed:
 * proxy applied, proxy auth applied, custom headers, fingerprint
 * rotation, heavy resources blocked.
 * Returns { context, page }. Caller MUST close the context.
 */
async function newFastPage(proxy, opts = {}) {
    const context = await newContext(proxy);
    const page = await context.newPage();
    await setupPage(page, proxy, opts);
    await attachSpeedInterceptor(page);
    return { context, page };
}

/**
 * Capture a PNG screenshot and attach it (base64) to an error, so the
 * API can return/save it when the request used debug:true.
 */
async function attachDebugShot(page, err) {
    try {
        err.debugScreenshot = await page.screenshot({
            type: 'png',
            encoding: 'base64',
        });
    } catch (e) {
        // page may already be gone — ignore
    }
}

function resolveTimeout(requestTimeout) {
    return requestTimeout || global.timeOut || 60000;
}

/**
 * waitForResponse that can never become an unhandled rejection: the waiter
 * is marked handled at creation, so if navigation throws before we await
 * it (or the overall timeout fires first), the later page close cannot
 * crash the process with TargetCloseError.
 */
function waitForResponseSafe(page, predicate, timeoutMs) {
    const p = page.waitForResponse(predicate, {
        timeout: Math.max(1000, (timeoutMs || 60000) - 5000),
    });
    p.catch(() => {});
    return p;
}

module.exports = {
    newContext,
    setupPage,
    newFastPage,
    attachSpeedInterceptor,
    attachDebugShot,
    resolveTimeout,
    waitForResponseSafe,
    BLOCKED_TYPES,
};
