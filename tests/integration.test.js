// Full HTTP flow against a fake browser: validation, retry, async jobs,
// timeout/headers threading, new modes — without launching Chrome.
process.env.NODE_ENV = 'development';
process.env.SKIP_LAUNCH = 'true';
process.env.MAX_ATTEMPTS = '2';
process.env.RETRY_BACKOFF_MS = '10';
process.env.FINGERPRINT_ROTATION = 'false';

const request = require('supertest');
const server = require('../src/index');

// ---- behavior knobs for the fake browser ----
const behavior = {
    evaluateResult: null,
    failTimes: 0, // goto throws this many times, then succeeds
};

function fakePage() {
    return {
        setRequestInterception: async () => {},
        on: () => {},
        goto: async () => {
            if (behavior.failTimes > 0) {
                behavior.failTimes -= 1;
                throw new Error('fake navigation failed');
            }
        },
        waitForResponse: async () => ({
            status: () => 200,
            url: () => 'https://example.com/',
            request: () => ({
                headers: () => ({ 'user-agent': 'fake' }),
            }),
        }),
        waitForNavigation: async () => {},
        content: async () => '<html><head><title>Example</title></head><body>ok</body></html>',
        cookies: async () => [{ name: 'cf_clearance', value: 'abc123' }],
        setUserAgent: async () => {},
        setViewport: async () => {},
        emulateTimezone: async () => {},
        setExtraHTTPHeaders: async () => {},
        evaluateOnNewDocument: async () => {},
        evaluate: async () => behavior.evaluateResult,
        waitForSelector: async () => {},
        authenticate: async () => {},
        screenshot: async () => Buffer.from('fakepng').toString('base64'),
        close: async () => {},
    };
}

function fakeContext() {
    return {
        newPage: async () => fakePage(),
        close: async () => {},
    };
}

global.browser = {
    createBrowserContext: async () => fakeContext(),
    newPage: async () => fakePage(),
};
global.timeOut = 10000;

const post = (body) => request(server).post('/cf-clearance-scraper').send(body);

test('detect returns protection report', async () => {
    behavior.evaluateResult = {
        protected: false,
        types: [],
        title: 'Example Domain',
        cfResponse: false,
    };
    const res = await post({ url: 'https://example.com/', mode: 'detect' }).expect(200);
    expect(res.body.protected).toBe(false);
    expect(res.body.title).toBe('Example Domain');
    expect(res.body.attempts).toBe(1);
}, 15000);

test('source returns page html', async () => {
    const res = await post({ url: 'https://example.com/', mode: 'source' }).expect(200);
    expect(res.body.source).toContain('Example');
    expect(res.body.attempts).toBe(1);
}, 15000);

test('waf-session returns cookies and headers', async () => {
    behavior.evaluateResult = 'en-US,en;q=0.9';
    const res = await post({ url: 'https://example.com/', mode: 'waf-session' }).expect(200);
    expect(res.body.cookies[0].name).toBe('cf_clearance');
    expect(res.body.headers['accept-language']).toBe('en-US,en;q=0.9');
}, 15000);

test('retry: failed attempt is retried with a fresh context', async () => {
    behavior.failTimes = 1; // first goto throws
    behavior.evaluateResult = 'x'.repeat(20);
    const res = await post({
        url: 'https://example.com/',
        mode: 'recaptcha',
        siteKey: 'test-site-key',
    }).expect(200);
    expect(res.body.token).toBe('x'.repeat(20));
    expect(res.body.attempts).toBe(2);
}, 15000);

test('hcaptcha mode solves via template', async () => {
    behavior.evaluateResult = 'y'.repeat(20);
    const res = await post({
        url: 'https://example.com/',
        mode: 'hcaptcha',
        siteKey: 'test-site-key',
        timeout: 30000,
        headers: { 'X-Test': '1' },
    }).expect(200);
    expect(res.body.token).toBe('y'.repeat(20));
}, 15000);

test('async job: 202 then pollable result', async () => {
    behavior.evaluateResult = {
        protected: true,
        types: ['cloudflare-waf'],
        title: 'Just a moment...',
        cfResponse: false,
    };
    const created = await post({
        url: 'https://example.com/',
        mode: 'detect',
        async: true,
    }).expect(202);
    expect(created.body.jobId).toMatch(/^job_/);

    let job;
    for (let i = 0; i < 40; i++) {
        const r = await request(server).get(`/jobs/${created.body.jobId}`).expect(200);
        job = r.body;
        if (job.status === 'done' || job.status === 'error') break;
        await new Promise((r2) => setTimeout(r2, 250));
    }
    expect(job.status).toBe('done');
    expect(job.result.protected).toBe(true);
    expect(job.result.attempts).toBe(1);
}, 20000);

test('unknown job id is 404', async () => {
    await request(server).get('/jobs/nope').expect(404);
});

test('schema rejects bad timeout and bad webhookUrl', async () => {
    await post({ url: 'https://example.com/', mode: 'detect', timeout: 100 }).expect(400);
    await post({ url: 'https://example.com/', mode: 'detect', webhookUrl: 'not-a-uri' }).expect(400);
});

test('metrics endpoint exposes request counters', async () => {
    const res = await request(server).get('/metrics').expect(200);
    expect(res.text).toContain('cfcs_requests_total');
});
