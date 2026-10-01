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

                // Use HTML template with script tags (proven pattern from Turnstile).
                // page.evaluate script injection is flaky on request.respond() pages.
                const fs = require('fs');
                const path = require('path');
                const template = String(
                    fs.readFileSync(path.join(__dirname, '..', 'data', 'recaptchaV3.html'))
                ).replace('<site-key>', siteKey);

                await page.setRequestInterception(true);
                page.on('request', (request) => {
                    try {
                        const rurl = request.url();
                        const rtype = request.resourceType();
                        // Serve the template for the target document
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

                // Wait for grecaptcha to be ready (signaled by template script)
                await page.waitForFunction(
                    () => window.__recaptchaReady === true,
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
