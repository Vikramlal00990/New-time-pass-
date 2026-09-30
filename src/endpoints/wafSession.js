'use strict';

const withTimeout = require('../module/timeout');
const {
    newFastPage,
    attachDebugShot,
    resolveTimeout,
    waitForResponseSafe,
} = require('../module/browserContext');
const getAcceptLanguage = require('../module/acceptLanguage');

function isMainDoc(res, url) {
    return (
        [200, 302].includes(res.status()) &&
        [url, url + '/'].includes(res.url())
    );
}

/**
 * Create a Cloudflare WAF session: solve the challenge once and return the
 * cookies + headers needed to send further requests without being blocked.
 */
async function wafSession({ url, proxy, headers, debug, timeout }) {
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
                const res = await responseReady;
                await page
                    .waitForNavigation({ waitUntil: 'load', timeout: 5000 })
                    .catch(() => {});

                const cookies = await page.cookies();
                const headers = await res.request().headers();
                // Hop-by-hop / body headers must not be replayed.
                delete headers['content-type'];
                delete headers['accept-encoding'];
                delete headers['accept'];
                delete headers['content-length'];
                headers['accept-language'] = await getAcceptLanguage();

                return { cookies, headers };
            })(),
            timeoutMs,
            'wafSession'
        );
    } catch (err) {
        if (debug) await attachDebugShot(page, err);
        throw err;
    } finally {
        await context.close().catch(() => {});
    }
}

module.exports = wafSession;
