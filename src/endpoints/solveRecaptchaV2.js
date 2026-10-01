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

                await page.setRequestInterception(true);
                page.on('request', (request) => {
                    try {
                        const rurl = request.url();
                        const rtype = request.resourceType();
                        if (([url, url + '/'].includes(rurl) && rtype === 'document')) {
                            request.respond({
                                status: 200,
                                contentType: 'text/html',
                                body: '<html><head></head><body><div id="v2-slot"></div></body></html>',
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

                // Inject api.js and render widget
                await page.evaluate((sk, inv) => {
                    return new Promise((resolve, reject) => {
                        const s = document.createElement('script');
                        s.src = 'https://www.google.com/recaptcha/api.js?render=explicit';
                        s.onload = () => {
                            try {
                                window.grecaptcha.render('v2-slot', {
                                    sitekey: sk,
                                    size: inv ? 'invisible' : 'normal',
                                });
                                if (inv) window.grecaptcha.execute();
                                resolve();
                            } catch (e) { reject(e); }
                        };
                        s.onerror = () => reject(new Error('recaptcha api.js load failed'));
                        document.head.appendChild(s);
                        setTimeout(() => reject(new Error('recaptcha api.js timeout')), 20000);
                    });
                }, siteKey, invisible === true);

                // Wait for token (poll getResponse)
                const token = await page.evaluate(() => {
                    return new Promise((resolve) => {
                        const iv = setInterval(() => {
                            try {
                                const r = window.grecaptcha.getResponse();
                                if (r) { clearInterval(iv); resolve(r); }
                            } catch (e) {}
                        }, 500);
                        // 55s max (outer timeout handles the rest)
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
