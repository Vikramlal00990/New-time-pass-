'use strict';

const withTimeout = require('../module/timeout');
const { newContext, setupPage, BLOCKED_TYPES, attachDebugShot, resolveTimeout } = require('../module/browserContext');

/**
 * Solve reCAPTCHA Enterprise (score-based).
 * Loads enterprise.js?render=siteKey and executes with the given action.
 * Every call solves fresh — tokens are never cached.
 */
async function solveRecaptchaEnterprise({ url, proxy, headers, debug, timeout, siteKey, action }) {
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

                // Inject enterprise.js with retry
                let injected = false;
                for (let attempt = 1; attempt <= 3 && !injected; attempt++) {
                    try {
                        await page.evaluate((sk) => {
                            return new Promise((resolve, reject) => {
                                const old = document.querySelector('script[src*="recaptcha/enterprise"]');
                                if (old) old.remove();
                                const s = document.createElement('script');
                                s.src = 'https://www.google.com/recaptcha/enterprise.js?render=' + sk;
                                s.onload = () => resolve();
                                s.onerror = () => reject(new Error('enterprise.js load failed'));
                                document.head.appendChild(s);
                                setTimeout(() => reject(new Error('enterprise.js timeout')), 20000);
                            });
                        }, siteKey);

                        await page.waitForFunction(
                            () => window.grecaptcha && window.grecaptcha.enterprise &&
                                  typeof window.grecaptcha.enterprise.execute === 'function',
                            { timeout: 20000 }
                        );
                        injected = true;
                    } catch (e) {
                        if (attempt === 3) throw new Error('Enterprise script failed after 3 attempts: ' + e.message);
                        await new Promise(r => setTimeout(r, 1500 * attempt));
                    }
                }

                const token = await page.evaluate((sk, a) => {
                    return new Promise((resolve, reject) => {
                        const t = setTimeout(() => reject(new Error('enterprise.execute timeout')), 20000);
                        try {
                            window.grecaptcha.enterprise.ready(() => {
                                window.grecaptcha.enterprise.execute(sk, { action: a })
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
            'solveRecaptchaEnterprise'
        );
    } catch (err) {
        if (debug && page) await attachDebugShot(page, err);
        throw err;
    } finally {
        await context.close().catch(() => {});
    }
}

module.exports = solveRecaptchaEnterprise;
