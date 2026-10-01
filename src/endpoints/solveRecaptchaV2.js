'use strict';

const withTimeout = require('../module/timeout');
const { newContext, setupPage, attachDebugShot, resolveTimeout } = require('../module/browserContext');

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

                // For reCAPTCHA v2, load the REAL page (no fake template).
                // Fake templates + manual interception break proxy authentication.
                // We render the widget on the real page via script injection.
                await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

                // Inject reCAPTCHA v2 api.js and render widget
                const size = invisible === true ? 'invisible' : 'normal';
                await page.evaluate((sk, sz) => {
                    return new Promise((resolve) => {
                        window.__v2Token = null;
                        window.__recaptchaReady = false;
                        window.__recaptchaError = null;
                        window.__v2Callback = function(token) {
                            window.__v2Token = token;
                        };
                        window.__v2Render = function() {
                            try {
                                window.__v2WidgetId = window.grecaptcha.render('v2widget', {
                                    'sitekey': sk,
                                    'size': sz,
                                    'callback': window.__v2Callback
                                });
                                window.__recaptchaReady = true;
                            } catch (e) {
                                window.__recaptchaError = e.message;
                            }
                            resolve();
                        };
                        // Create container
                        const div = document.createElement('div');
                        div.id = 'v2widget';
                        document.body.appendChild(div);
                        // Load api.js
                        const s = document.createElement('script');
                        s.src = 'https://www.google.com/recaptcha/api.js?onload=__v2Render&render=explicit';
                        s.onerror = () => { window.__recaptchaError = 'api.js load failed'; resolve(); };
                        document.head.appendChild(s);
                        setTimeout(() => resolve(), 20000);
                    });
                }, siteKey, size);

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
