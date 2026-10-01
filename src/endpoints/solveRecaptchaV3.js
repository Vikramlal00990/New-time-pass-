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

                await page.setRequestInterception(true);
                page.on('request', (request) => {
                    try {
                        const rurl = request.url();
                        const rtype = request.resourceType();
                        // Allow the target document and recaptcha scripts
                        if (([url, url + '/'].includes(rurl) && rtype === 'document')) {
                            request.respond({
                                status: 200,
                                contentType: 'text/html',
                                body: '<html><head></head><body></body></html>',
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

                // Inject api.js?render=siteKey
                await page.evaluate((sk) => {
                    return new Promise((resolve, reject) => {
                        if (window.grecaptcha) return resolve();
                        const s = document.createElement('script');
                        s.src = 'https://www.google.com/recaptcha/api.js?render=' + sk;
                        s.onload = () => resolve();
                        s.onerror = () => reject(new Error('recaptcha api.js load failed'));
                        document.head.appendChild(s);
                        setTimeout(() => reject(new Error('recaptcha api.js timeout')), 20000);
                    });
                }, siteKey);

                await page.waitForFunction(
                    () => window.grecaptcha && typeof window.grecaptcha.execute === 'function',
                    { timeout: 20000 }
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
