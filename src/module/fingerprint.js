'use strict';

// Per-request browser fingerprint rotation: user-agent, viewport and
// timezone/locale are randomized together (as consistent profiles) so each
// browser context looks like a different real device.
// Disable with FINGERPRINT_ROTATION=false.

const PROFILES = [
    {
        ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        width: 1920, height: 1080, mobile: false,
    },
    {
        ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        width: 1440, height: 900, mobile: false,
    },
    {
        ua: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        width: 1366, height: 768, mobile: false,
    },
    {
        ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
        width: 1536, height: 864, mobile: false,
    },
    {
        ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
        width: 412, height: 915, mobile: true,
    },
];

const ZONES = [
    { tz: 'America/New_York', locale: 'en-US' },
    { tz: 'Europe/London', locale: 'en-GB' },
    { tz: 'Europe/Berlin', locale: 'de-DE' },
    { tz: 'Asia/Dubai', locale: 'ar-AE' },
    { tz: 'Asia/Karachi', locale: 'ur-PK' },
    { tz: 'Asia/Singapore', locale: 'en-SG' },
];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

async function applyFingerprint(page) {
    if (process.env.FINGERPRINT_ROTATION === 'false') return null;
    const p = pick(PROFILES);
    const z = pick(ZONES);
    await page.setUserAgent(p.ua);
    await page.setViewport({
        width: p.width,
        height: p.height,
        isMobile: p.mobile,
        hasTouch: p.mobile,
    });
    try {
        await page.emulateTimezone(z.tz);
    } catch (e) {
        // not supported by this puppeteer build — ignore
    }
    await page.evaluateOnNewDocument((locale) => {
        try {
            Object.defineProperty(navigator, 'language', {
                get: () => locale,
            });
            Object.defineProperty(navigator, 'languages', {
                get: () => [locale, locale.split('-')[0]],
            });
        } catch (e) {}
    }, z.locale);
    return {
        userAgent: p.ua,
        viewport: `${p.width}x${p.height}`,
        timezone: z.tz,
        locale: z.locale,
    };
}

module.exports = { applyFingerprint, PROFILES, ZONES };
