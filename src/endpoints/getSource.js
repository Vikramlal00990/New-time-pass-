'use strict';

const withTimeout = require('../module/timeout');
const {
    newFastPage,
    attachDebugShot,
    resolveTimeout,
    waitForResponseSafe,
} = require('../module/browserContext');

function isMainDoc(res, url) {
    return (
        [200, 302].includes(res.status()) &&
        [url, url + '/'].includes(res.url())
    );
}

/**
 * Load a page through the Cloudflare challenge and return its HTML source.
 */
async function getSource({ url, proxy, headers, debug, timeout }) {
    if (!url) throw new Error('Missing url parameter');

    const { context, page } = await newFastPage(proxy, { headers });
    const timeoutMs = resolveTimeout(timeout);
    try {
        return await withTimeout(
            (async () => {
                const responseReady = waitForResponseSafe(
                    page,
                    (res) => isMainDoc(res, url),
                    timeoutMs
                );
                await page.goto(url, { waitUntil: 'domcontentloaded' });
                await responseReady;
                await page
                    .waitForNavigation({ waitUntil: 'load', timeout: 5000 })
                    .catch(() => {});
                return await page.content();
            })(),
            timeoutMs,
            'getSource'
        );
    } catch (err) {
        if (debug) await attachDebugShot(page, err);
        throw err;
    } finally {
        await context.close().catch(() => {});
    }
}

module.exports = getSource;
