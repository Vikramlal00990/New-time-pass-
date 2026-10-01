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

                // Inject reCAPTCHA v3 api.js ourselves (don't depend on the page).
                // With a working proxy, Google serves the script.
                const injected = await page.evaluate((sk) => {
                    return new Promise((resolve) => {
                        if (window.grecaptcha && typeof window.grecaptcha.execute === 'function') {
                            return resolve('already-present');
                        }
                        const s = document.createElement('script');
                        s.src = 'https://www.google.com/recaptcha/api.js?render=' + encodeURIComponent(sk);
                        s.onload = () => resolve('loaded');
                        s.onerror = () => resolve('error');
                        document.head.appendChild(s);
                        setTimeout(() => resolve('timeout'), 20000);
                    });
                }, siteKey);

                // Diagnostic: check what actually loaded
                const diag = await page.evaluate(() => ({
                    hasGrecaptcha: typeof window.grecaptcha !== 'undefined',
                    grecaptchaKeys: window.grecaptcha ? Object.keys(window.grecaptcha).slice(0, 10) : [],
                    hasExecute: !!(window.grecaptcha && window.grecaptcha.execute),
                    scripts: Array.from(document.scripts).map(s => s.src).filter(s => s.includes('recaptcha') || s.includes('google')).slice(0, 5),
                    title: document.title.substring(0, 50)
                }));
                diag.injected = injected;

                try {
                    await page.waitForFunction(
                        () => window.grecaptcha && typeof window.grecaptcha.execute === 'function',
                        { timeout: 25000 }
                    );
                } catch (e) {
                    const hint = !diag.hasGrecaptcha
                        ? ' Google blocked reCAPTCHA scripts (IP flagged or sitekey/domain mismatch).'
                        : '';
                    throw new Error('recaptcha not ready.' + hint + ' Diag: ' + JSON.stringify(diag));
                }

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
