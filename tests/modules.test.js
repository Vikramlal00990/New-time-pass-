'use strict';

const withTimeout = require('../src/module/timeout');
const { buildProxyServer, SUPPORTED_PROTOCOLS } = require('../src/module/proxy');

test('withTimeout resolves fast promises', async () => {
    const v = await withTimeout(Promise.resolve(42), 1000, 't');
    expect(v).toBe(42);
}, 5000);

test('withTimeout rejects slow promises', async () => {
    await expect(
        withTimeout(new Promise(() => {}), 100, 'slow-op')
    ).rejects.toThrow('slow-op timed out after 100ms');
}, 5000);

test('buildProxyServer defaults to http', () => {
    expect(buildProxyServer({ host: 'h', port: 8080 })).toBe('http://h:8080');
});

test('buildProxyServer supports all protocols', () => {
    for (const p of SUPPORTED_PROTOCOLS) {
        expect(buildProxyServer({ protocol: p, host: 'h', port: 1 })).toBe(
            `${p}://h:1`
        );
    }
});

test('buildProxyServer returns undefined without proxy', () => {
    expect(buildProxyServer(null)).toBeUndefined();
    expect(buildProxyServer(undefined)).toBeUndefined();
});

test('buildProxyServer rejects bad protocol', () => {
    expect(() => buildProxyServer({ protocol: 'ftp', host: 'h', port: 1 })).toThrow(
        /Unsupported proxy protocol/
    );
});

test('buildProxyServer rejects missing host/port', () => {
    expect(() => buildProxyServer({ host: 'h' })).toThrow(/host.*port/);
});

describe('proxyPool', () => {
    const { parseProxyLine } = require('../src/module/proxyPool');

    test('parses all line formats', () => {
        expect(parseProxyLine('socks5://user:pass@1.2.3.4:1080')).toMatchObject({
            protocol: 'socks5', host: '1.2.3.4', port: 1080,
            username: 'user', password: 'pass',
        });
        expect(parseProxyLine('http://1.2.3.4:8080')).toMatchObject({
            protocol: 'http', host: '1.2.3.4', port: 8080,
        });
        expect(parseProxyLine('1.2.3.4:8080:user:pass')).toMatchObject({
            protocol: 'http', host: '1.2.3.4', port: 8080,
            username: 'user', password: 'pass',
        });
        expect(parseProxyLine('1.2.3.4:8080')).toMatchObject({
            host: '1.2.3.4', port: 8080,
        });
    });

    test('rejects comments, blanks and bad lines', () => {
        expect(parseProxyLine('# comment')).toBeNull();
        expect(parseProxyLine('')).toBeNull();
        expect(parseProxyLine('   ')).toBeNull();
        expect(parseProxyLine('not-a-proxy')).toBeNull();
        expect(parseProxyLine('ftp://1.2.3.4:21')).toBeNull();
    });

    test('pool rotates and bans failing proxies', () => {
        jest.resetModules();
        process.env.PROXY_POOL = JSON.stringify([
            { host: 'a', port: 1 },
            { host: 'b', port: 2 },
        ]);
        process.env.PROXY_MAX_FAILS = '2';
        process.env.PROXY_BAN_MS = '60000';
        const pp = require('../src/module/proxyPool');

        const first = pp.acquireProxy(null);
        const second = pp.acquireProxy(null);
        expect(first.proxy.host).not.toBe(second.proxy.host);

        // explicit proxy always wins, pool untouched
        const exp = pp.acquireProxy({ host: 'x', port: 9 });
        expect(exp.proxy.host).toBe('x');
        expect(exp.entry).toBeNull();

        // two fails -> banned (MAX_FAILS=2)
        pp.reportProxy(first.entry, false);
        pp.reportProxy(first.entry, false);
        for (let i = 0; i < 4; i++) {
            expect(pp.acquireProxy(null).proxy.host).toBe(second.proxy.host);
        }
        expect(pp.poolStatus()).toMatchObject({ size: 2, available: 1 });

        // success resets the ban counter
        pp.reportProxy(second.entry, true);
        expect(second.entry.fails).toBe(0);

        delete process.env.PROXY_POOL;
        delete process.env.PROXY_MAX_FAILS;
        delete process.env.PROXY_BAN_MS;
    });
});

describe('metrics', () => {
    test('counts and renders prometheus format', () => {
        jest.resetModules();
        const m = require('../src/module/metrics');
        m.requestStarted();
        m.requestFinished('waf-session', true, 1500);
        m.requestFinished('waf-session', false, 500);
        m.retried();
        m.proxyFailed();
        const out = m.renderPrometheus();
        expect(out).toContain('cfcs_requests_total{mode="waf-session",status="ok"} 1');
        expect(out).toContain('cfcs_requests_total{mode="waf-session",status="error"} 1');
        expect(out).toContain('cfcs_request_avg_duration_ms{mode="waf-session"} 1000');
        expect(out).toContain('cfcs_active_requests 0');
        expect(out).toContain('cfcs_retries_total 1');
        expect(out).toContain('cfcs_proxy_failures_total 1');
    });
});
