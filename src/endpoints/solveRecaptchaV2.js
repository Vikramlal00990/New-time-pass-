'use strict';

const withTimeout = require('../module/timeout');
const { newContext, setupPage, BLOCKED_TYPES, attachDebugShot, resolveTimeout } = require('../module/browserContext');

/**
 * Solve reCAPTCHA v2 (checkbox or invisible).
 * Renders the widget and waits for a token.
 *
 * NOTE: Checkbox ("I'm not a robot") v2 requires human interaction and
 * cannot be solved automatically. Use this for invisible v2, or with
 * manual intervention. The token is harvested fresh on every call.
 */
async function solveRecaptchaV2({ url, proxy, headers, debug, timeout, siteKey, invisible }) {
    if (!url) throw new Error('Missing url parameter');
    if (!siteKey) throw new Error('Missing siteKey parameter');

    const context = await newContext(proxy);
    let page = null;
    try {
        return await withTimeout(
            (async () => {
                page = await context.newPage();
                await setupPage(page, proxy, { headers });

                // Use HTML template with script tags (proven pattern from Turnstile).
                const fs = require('fs');
                const path = require('path');
                const size = invisible === true ? 'invisible' : 'normal';
                const template = String(
                    fs.readFileSync(path.join(__dirname, '..', 'data', 'recaptchaV2.html'))
                ).replace('<site-key>', siteKey).replace(/<size>/g, size);

                await page.setRequestInterception(true);
                page.on('request', (request) => {
                    try {
                        const rurl = request.url();
                        const rtype = request.resourceType();
                        if (([url, url + '/'].includes(rurl) && rtype === 'document')) {
                            request.respond({
                                status: 200,
                                contentType: 'text/html',
                                body: template,
                            });
                        } else if (rurl.includes('google.com/recaptcha') || rurl.includes('gstatic.com/recaptcha')) {
                            request.continue();
                        } else if (BLOCKED_TYPES.has(rtype)) {
                            request.abort();
                        } else {
                            request.continue();
                        }
                    } catch (e) {}
                });

                await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

                // Wait for widget to render (or error)
                await page.waitForFunction(
                    () => window.__recaptchaReady === true || window.__recaptchaError,
                    { timeout: 25000 }
                );

                const recaptchaErr = await page.evaluate(() => window.__recaptchaError);
                if (recaptchaErr) throw new Error('reCAPTCHA render failed: ' + recaptchaErr);

                // Wait for token (poll __v2Token set by callback)
                const token = await page.evaluate(() => {
                    return new Promise((resolve) => {
                        const iv = setInterval(() => {
                            try {
                                if (window.__v2Token) { clearInterval(iv); resolve(window.__v2Token); }
                                // Also try getResponse as fallback
                                else if (window.grecaptcha && window.__v2WidgetId !== undefined) {
                                    const r = window.grecaptcha.getResponse(window.__v2WidgetId);
                                    if (r) { clearInterval(iv); resolve(r); }
                                }
                            } catch (e) {}
                        }, 500);
                        setTimeout(() => { clearInterval(iv); resolve(null); }, 55000);
                    });
                });

                if (!token || token.length < 20) throw new Error('Failed to get token (v2 may require manual solving)');
                return token;
            })(),
            resolveTimeout(timeout),
            'solveRecaptchaV2'
        );
    } catch (err) {
        if (debug && page) await attachDebugShot(page, err);
        throw err;
    } finally {
        await context.close().catch(() => {});
    }
}

module.exports = solveRecaptchaV2;
