'use strict';

// The Accept-Language header the real browser sends. Resolved once per
// process and cached — the original code hit httpbin.org on EVERY request,
// which was slow and added an external dependency to the hot path.
let cached = null;
let pending = null;

async function getAcceptLanguage() {
    if (cached) return cached;
    if (pending) return pending;
    pending = (async () => {
        try {
            const page = await global.browser.newPage();
            try {
                const lang = await page.evaluate(async () => {
                    try {
                        const ctrl = new AbortController();
                        const t = setTimeout(() => ctrl.abort(), 8000);
                        const res = await fetch('https://httpbin.org/get', {
                            signal: ctrl.signal,
                        }).then((r) => r.json());
                        clearTimeout(t);
                        return (
                            res.headers['Accept-Language'] ||
                            res.headers['accept-language'] ||
                            null
                        );
                    } catch (e) {
                        return null;
                    }
                });
                cached = lang || (await page.evaluate(() => navigator.language)) || 'en-US,en;q=0.9';
            } finally {
                await page.close().catch(() => {});
            }
        } catch (e) {
            cached = 'en-US,en;q=0.9';
        }
        return cached;
    })();
    return pending;
}

module.exports = getAcceptLanguage;
