'use strict';

const withTimeout = require('../module/timeout');
const { newFastPage, attachDebugShot, resolveTimeout } = require('../module/browserContext');

/**
 * Solve a VISIBLE Turnstile on the real page: poll window.turnstile for
 * the token, then expose it through a hidden cf-response input.
 */
async function solveTurnstileMax({ url, proxy, headers, debug, timeout }) {
    if (!url) throw new Error('Missing url parameter');

    const { context, page } = await newFastPage(proxy, { headers });
    try {
        return await withTimeout(
            (async () => {
                await page.evaluateOnNewDocument(() => {
                    let token = null;
                    async function waitForToken() {
                        while (!token) {
                            try {
                                token = window.turnstile.getResponse();
                            } catch (e) {}
                            await new Promise((resolve) => setTimeout(resolve, 500));
                        }
                        const c = document.createElement('input');
                        c.type = 'hidden';
                        c.name = 'cf-response';
                        c.value = token;
                        document.body.appendChild(c);
                    }
                    waitForToken();
                });

                await page.goto(url, { waitUntil: 'domcontentloaded' });
                await page.waitForSelector('[name="cf-response"]', {
                    timeout: 60000,
                });

                const token = await page.evaluate(() => {
                    try {
                        return document.querySelector('[name="cf-response"]').value;
                    } catch (e) {
                        return null;
                    }
                });

                if (!token || token.length < 10) {
                    throw new Error('Failed to get token');
                }
                return token;
            })(),
            resolveTimeout(timeout),
            'solveTurnstileMax'
        );
    } catch (err) {
        if (debug) await attachDebugShot(page, err);
        throw err;
    } finally {
        await context.close().catch(() => {});
    }
}

module.exports = solveTurnstileMax;
