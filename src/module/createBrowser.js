'use strict';

const { connect } = require('puppeteer-real-browser');

async function createBrowser() {
    try {
        if (global.finished == true) return;

        global.browser = null;

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
