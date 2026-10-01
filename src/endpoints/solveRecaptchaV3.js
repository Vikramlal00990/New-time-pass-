'use strict';

const withTimeout = require('../module/timeout');
const { newContext, setupPage, BLOCKED_TYPES, attachDebugShot, resolveTimeout } = require('../module/browserContext');

/**
 * Solve reCAPTCHA v3 (score-based, invisible).
 * Loads api.js?render=siteKey and executes with the given action.
 * Every call solves fresh — tokens are never cached.
 */
async function solveRecaptchaV3({ url, proxy, headers, debug, timeout, siteKey, action }) {
    if (!url) throw new Error('Missing url parameter');
    if (!siteKey) throw new Error('Missing siteKey parameter');

    const act = action || 'submit';
    const context = await newContext(proxy);
    let page = null;
    try {
        return await withTimeout(
            (async () => {
                page = await context.newPage();
                await setupPage(page, proxy, { headers });

                // For reCAPTCHA v3, load the REAL page (not a fake template).
                // Google's api.js validates origin/referrer and blocks fake pages.
                // We navigate to the actual URL and execute grecaptcha there.
                await page.setRequestInterception(true);
                page.on('request', (request) => {
                    try {
                        const rtype = request.resourceType();
                        // Don't intercept the document — let the real page load
                        if (BLOCKED_TYPES.has(rtype)) {
                            request.abort();
                        } else {
                            request.continue();
                        }
                    } catch (e) {}
                });

                await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

                // The test page already loads its own reCAPTCHA v3.
                // Use the page's existing grecaptcha instance instead of injecting.
                // (Injecting api.js triggers Google's bot detection.)
                await page.waitForFunction(
                    () => window.grecaptcha && typeof window.grecaptcha.execute === 'function',
                    { timeout: 25000 }
                );

                const token = await page.evaluate((sk, a) => {
                    return new Promise((resolve, reject) => {
                        const t = setTimeout(() => reject(new Error('grecaptcha.execute timeout')), 20000);
                        try {
                            window.grecaptcha.ready(() => {
                                window.grecaptcha.execute(sk, { action: a })
                                    .then((tok) => { clearTimeout(t); resolve(tok); })
                                    .catch((e) => { clearTimeout(t); reject(e); });
                            });
                        } catch (e) { clearTimeout(t); reject(e); }
                    });
                }, siteKey, act);

                if (!token || token.length < 20) throw new Error('Invalid token received');
                return token;
            })(),
            resolveTimeout(timeout),
            'solveRecaptchaV3'
        );
    } catch (err) {
        if (debug && page) await attachDebugShot(page, err);
        throw err;
    } finally {
        await context.close().catch(() => {});
    }
}

module.exports = solveRecaptchaV3;
