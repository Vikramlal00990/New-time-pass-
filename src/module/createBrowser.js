'use strict';

const fs = require('fs');
const { connect } = require('puppeteer-real-browser');

// If CHROME_PATH is not set, look for Chrome in the usual places
// (Docker image, apt installs, etc.) so the server works with zero config.
function resolveChromePath() {
    if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
    const candidates = [
        '/opt/chrome/chrome-linux64/chrome', // our Dockerfile
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/snap/bin/chromium',
    ];
    for (const p of candidates) {
        try {
            if (fs.existsSync(p)) {
                process.env.CHROME_PATH = p;
                console.log('CHROME_PATH auto-detected:', p);
                return p;
            }
        } catch (_) { /* ignore */ }
    }
    return null;
}

async function createBrowser() {
    try {
        if (global.finished == true) return;

        global.browser = null;
        resolveChromePath();

        // Extra Chrome flags, space-separated, e.g.
        // CHROME_ARGS="--no-sandbox --proxy-server=http://127.0.0.1:8080"
        const extraArgs = (process.env.CHROME_ARGS || '')
            .split(' ')
            .map((s) => s.trim())
            .filter(Boolean);

        const { browser } = await connect({
            headless: process.env.HEADLESS === 'true',
            turnstile: true,
            connectOption: { defaultViewport: null },
            disableXvfb: false,
            args: extraArgs,
        });

        global.browser = browser;

        browser.on('disconnected', async () => {
            if (global.finished == true) return;
            console.log('Browser disconnected — relaunching in 3s');
            await new Promise((resolve) => setTimeout(resolve, 3000));
            await createBrowser();
        });
    } catch (e) {
        console.log('Browser launch failed:', e.message);
        if (global.finished == true) return;
        await new Promise((resolve) => setTimeout(resolve, 3000));
        await createBrowser();
    }
}

if (process.env.SKIP_LAUNCH != 'true') createBrowser();

module.exports = createBrowser;
