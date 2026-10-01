process.env.NODE_ENV = 'development';
process.env.SKIP_LAUNCH = 'true';
process.env.AUTH_TOKENS = 'tokA,tokB';
process.env.FINGERPRINT_ROTATION = 'false';

global.browserLimit = 2;

const semaphore = require('../src/module/semaphore');
const auth = require('../src/module/auth');
const jobs = require('../src/module/jobs');
const { applyFingerprint, PROFILES, ZONES } = require('../src/module/fingerprint');

describe('semaphore', () => {
    test('grants up to the limit then refuses', async () => {
        expect(await semaphore.acquire(0)).toBe(true);
        expect(await semaphore.acquire(0)).toBe(true);
        expect(await semaphore.acquire(0)).toBe(false);
        expect(global.browserLength).toBe(2);
        semaphore.release();
        semaphore.release();
        expect(global.browserLength).toBe(0);
    });

    test('waiter gets the slot when released (FIFO transfer)', async () => {
        expect(await semaphore.acquire(0)).toBe(true);
        expect(await semaphore.acquire(0)).toBe(true);
        const p = semaphore.acquire(5000);
        expect(semaphore.queued).toBe(1);
        semaphore.release(); // slot transfers to the waiter
        expect(await p).toBe(true);
        expect(global.browserLength).toBe(2);
        semaphore.release();
        semaphore.release();
        expect(global.browserLength).toBe(0);
    });

    test('acquire times out when no slot frees', async () => {
        expect(await semaphore.acquire(0)).toBe(true);
        expect(await semaphore.acquire(0)).toBe(true);
        const t0 = Date.now();
        expect(await semaphore.acquire(200)).toBe(false);
        expect(Date.now() - t0).toBeGreaterThanOrEqual(150);
        semaphore.release();
        semaphore.release();
    });

    test('respects a changed browserLimit', async () => {
        global.browserLimit = 1;
        expect(await semaphore.acquire(0)).toBe(true);
        expect(await semaphore.acquire(0)).toBe(false);
        semaphore.release();
        global.browserLimit = 2;
    });
});

describe('auth (multi-token)', () => {
    test('auth is enabled with AUTH_TOKENS', () => {
        expect(auth.enabled()).toBe(true);
    });

    test('accepts each configured token, rejects others', () => {
        expect(auth.verify('tokA').ok).toBe(true);
        expect(auth.verify('tokB').ok).toBe(true);
        expect(auth.verify('tokC').ok).toBe(false);
        expect(auth.verify('').ok).toBe(false);
        expect(auth.verify(undefined).ok).toBe(false);
    });

    test('tokens without a limit never gate', () => {
        const { entry } = auth.verify('tokA');
        expect(auth.tokenStart(entry)).toBe(true);
        expect(auth.tokenStart(entry)).toBe(true);
        auth.tokenEnd(entry);
        auth.tokenEnd(entry);
    });

    test('per-token concurrency limit is enforced', () => {
        const entry = { token: 'tokL', limit: 1 };
        expect(auth.tokenStart(entry)).toBe(true);
        expect(auth.tokenStart(entry)).toBe(false);
        auth.tokenEnd(entry);
        expect(auth.tokenStart(entry)).toBe(true);
        auth.tokenEnd(entry);
    });
});

describe('jobs', () => {
    test('create/get round-trip', () => {
        const job = jobs.createJob({ mode: 'detect', url: 'https://example.com/' });
        expect(job.id).toMatch(/^job_/);
        expect(job.status).toBe('queued');
        const got = jobs.getJob(job.id);
        expect(got).toBe(job);
        expect(jobs.getJob('nope')).toBe(null);
    });
});

describe('fingerprint', () => {
    test('disabled via env returns null without touching the page', async () => {
        const calls = [];
        const fakePage = new Proxy({}, { get: () => (...a) => { calls.push(a); } });
        expect(await applyFingerprint(fakePage)).toBe(null);
        expect(calls.length).toBe(0);
    });

    test('profiles and zones look real', () => {
        expect(PROFILES.length).toBeGreaterThan(2);
        expect(ZONES.length).toBeGreaterThan(2);
        for (const p of PROFILES) {
            expect(p.ua).toMatch(/Chrome\/13/);
            expect(p.width).toBeGreaterThan(300);
        }
    });
});

describe('turbo warm pool', () => {
    const warmPool = require('../src/module/warmPool');
    const validate = require('../src/module/reqValidate');

    test('poolKey groups by origin and proxy', () => {
        expect(warmPool.poolKey('https://a.com/', null)).toBe('https://a.com|direct');
        expect(warmPool.poolKey('https://a.com/x?y=1', null)).toBe('https://a.com|direct');
        expect(warmPool.poolKey('https://a.com/', { host: 'h', port: 8080 })).toBe(
            'https://a.com|http://h:8080'
        );
        expect(warmPool.poolKey('https://b.com/', null)).not.toBe(
            warmPool.poolKey('https://a.com/', null)
        );
    });

    test('turbo flag passes validation', () => {
        expect(
            validate({ mode: 'turnstile-min', url: 'https://example.com/', turbo: true })
        ).toBe(true);
        expect(
            validate({ mode: 'turnstile-min', url: 'https://example.com/', turbo: 'yes' })
        ).not.toBe(true);
    });

    test('acquire with no browser falls back (returns null, no throw)', async () => {
        // global.browser is undefined in tests (SKIP_LAUNCH) — acquire must
        // not throw; the endpoint falls back to a normal solve instead.
        const res = await warmPool.acquire('https://example.com/', null);
        expect(res).toBe(null);
    });
});
