'use strict';

const fs = require('fs');
const path = require('path');
const withTimeout = require('./timeout');
const { newContext, setupPage, BLOCKED_TYPES, attachDebugShot, resolveTimeout } = require('./browserContext');

/**
 * Shared solver for INVISIBLE widgets (Turnstile / reCAPTCHA v3 / hCaptcha):
 * the target document is replaced with a local widget page carrying the
 * siteKey, the token is harvested from the hidden cf-response input.
 *
 * Every call solves fresh — tokens are never cached.
 */
async function solveInvisibleWidget({
    url,
    proxy,
    headers,
    debug,
    timeout,
    siteKey,
    template,
    label,
}) {
    if (!url) throw new Error('Missing url parameter');
    if (!siteKey) throw new Error('Missing siteKey parameter');

    const context = await newContext(proxy);
    let page = null;
    try {
        return await withTimeout(
            (async () => {
                page = await context.newPage();
                await setupPage(page, proxy, { headers });

                const body = String(
                    fs.readFileSync(path.join(__dirname, '..', 'data', template))
                ).replace(/<site-key>/g, siteKey);

                await page.setRequestInterception(true);
                page.on('request', (request) => {
                    try {
                        if (
                            [url, url + '/'].includes(request.url()) &&
                            request.resourceType() === 'document'
                        ) {
                            request.respond({
                                status: 200,
                                contentType: 'text/html',
                                body,
                            });
                        } else if (BLOCKED_TYPES.has(request.resourceType())) {
                            request.abort();
                        } else {
                            request.continue();
                        }
                    } catch (e) {
                        // page may already be closed — ignore
                    }
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
            label
        );
    } catch (err) {
        if (debug && page) await attachDebugShot(page, err);
        throw err;
    } finally {
        await context.close().catch(() => {});
    }
}

module.exports = { solveInvisibleWidget };
