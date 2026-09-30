'use strict';

const withTimeout = require('../module/timeout');
const { newFastPage, resolveTimeout } = require('../module/browserContext');

/**
 * Detect what kind of bot protection a URL has, without solving anything.
 * Returns { protected, types, title } where types may include
 * "cloudflare-waf", "turnstile", "captcha".
 */
async function detect({ url, proxy, headers, timeout }) {
    if (!url) throw new Error('Missing url parameter');

    const { context, page } = await newFastPage(proxy, { headers });
    try {
        return await withTimeout(
            (async () => {
                await page
                    .goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
                    .catch(() => {});
                // give the challenge a moment to render
                await new Promise((r) => setTimeout(r, 3000));

                return await page.evaluate(() => {
                    const html = document.documentElement
                        ? document.documentElement.outerHTML || ''
                        : '';
                    const types = [];
                    const title = document.title || '';

                    if (
                        /just a moment/i.test(title) ||
                        html.includes('cf-chl') ||
                        html.includes('__cf_chl') ||
                        html.includes('challenges.cloudflare.com/orchestrate')
                    ) {
                        types.push('cloudflare-waf');
                    }
                    if (
                        document.querySelector(
                            'iframe[src*="challenges.cloudflare.com"]'
                        ) ||
                        /turnstile/i.test(html)
                    ) {
                        types.push('turnstile');
                    }
                    if (/re-?captcha|h-?captcha/i.test(html)) {
                        types.push('captcha');
                    }
                    return {
                        protected: types.length > 0,
                        types,
                        title,
                    };
                });
            })(),
            resolveTimeout(timeout),
            'detect'
        );
    } finally {
        await context.close().catch(() => {});
    }
}

module.exports = detect;
