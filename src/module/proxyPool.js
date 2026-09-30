'use strict';

const fs = require('fs');
const { SUPPORTED_PROTOCOLS } = require('./proxy');

const BAN_MS = Number(process.env.PROXY_BAN_MS) || 5 * 60 * 1000;
const MAX_FAILS = Number(process.env.PROXY_MAX_FAILS) || 3;

/**
 * Parse one proxy line. Supported formats:
 *   socks5://user:pass@host:port
 *   http://host:port
 *   host:port:user:pass
 *   host:port
 * Returns null for blank/comment/invalid lines.
 */
function parseProxyLine(line) {
    if (!line) return null;
    line = line.trim();
    if (!line || line.startsWith('#')) return null;

    let protocol = 'http';
    let rest = line;
    const pm = line.match(/^([a-z0-9+]+):\/\/(.+)$/i);
    if (pm) {
        protocol = pm[1].toLowerCase();
        rest = pm[2];
    }
    if (!SUPPORTED_PROTOCOLS.includes(protocol)) return null;

    let username;
    let password;
    let host;
    let port;

    const withAuth = rest.match(/^(?:([^:@]+):([^@]+)@)?([^:]+):(\d+)$/);
    if (withAuth) {
        username = withAuth[1];
        password = withAuth[2];
        host = withAuth[3];
        port = Number(withAuth[4]);
    } else {
        const parts = rest.split(':');
        if (parts.length === 4) {
            host = parts[0];
            port = Number(parts[1]);
            username = parts[2];
            password = parts[3];
        } else if (parts.length === 2) {
            host = parts[0];
            port = Number(parts[1]);
        } else {
            return null;
        }
    }
    if (!host || !port) return null;
    return { protocol, host, port, username, password, fails: 0, bannedUntil: 0 };
}

function fromObject(o) {
    if (!o || !o.host || !o.port) return null;
    const protocol = String(o.protocol || 'http').toLowerCase();
    if (!SUPPORTED_PROTOCOLS.includes(protocol)) return null;
    return {
        protocol,
        host: o.host,
        port: Number(o.port),
        username: o.username,
        password: o.password,
        fails: 0,
        bannedUntil: 0,
    };
}

const pool = [];

(function loadPool() {
    // JSON array via env: PROXY_POOL='[{"protocol":"socks5","host":"1.2.3.4","port":1080}]'
    if (process.env.PROXY_POOL) {
        try {
            const arr = JSON.parse(process.env.PROXY_POOL);
            if (Array.isArray(arr)) {
                for (const o of arr) {
                    const e = fromObject(o);
                    if (e) pool.push(e);
                }
            }
        } catch (e) {
            console.log('PROXY_POOL parse error:', e.message);
        }
    }
    // line-based file via env: PROXY_FILE=/path/to/proxies.txt
    if (process.env.PROXY_FILE) {
        try {
            const lines = fs.readFileSync(process.env.PROXY_FILE, 'utf8').split('\n');
            for (const line of lines) {
                const e = parseProxyLine(line);
                if (e) pool.push(e);
            }
        } catch (e) {
            console.log('PROXY_FILE read error:', e.message);
        }
    }
    if (pool.length) console.log(`Proxy pool loaded: ${pool.length} proxies`);
})();

let cursor = 0;

function pickEntry() {
    const now = Date.now();
    for (let i = 0; i < pool.length; i++) {
        cursor = (cursor + 1) % pool.length;
        const e = pool[cursor];
        if (e.bannedUntil <= now) return e;
    }
    return null;
}

function entryToConfig(e) {
    return {
        protocol: e.protocol,
        host: e.host,
        port: e.port,
        username: e.username,
        password: e.password,
    };
}

/**
 * Resolve which proxy a request should use.
 * Explicit per-request proxy always wins; otherwise rotate the pool;
 * otherwise direct connection. Returns { proxy, entry } — entry is the
 * pool entry to report back via reportProxy(), or null.
 */
function acquireProxy(explicitProxy) {
    if (explicitProxy) return { proxy: explicitProxy, entry: null };
    const entry = pickEntry();
    if (!entry) return { proxy: undefined, entry: null };
    return { proxy: entryToConfig(entry), entry };
}

/**
 * Report a pool proxy's result. `ok=false` counts a failure; after
 * MAX_FAILS consecutive failures the proxy is banned for BAN_MS.
 */
function reportProxy(entry, ok) {
    if (!entry) return;
    if (ok) {
        entry.fails = 0;
        entry.bannedUntil = 0;
    } else {
        entry.fails += 1;
        if (entry.fails >= MAX_FAILS) {
            entry.bannedUntil = Date.now() + BAN_MS;
            console.log(
                `Proxy ${entry.host}:${entry.port} banned for ${Math.round(BAN_MS / 1000)}s after ${entry.fails} fails`
            );
        }
    }
}

function poolStatus() {
    const now = Date.now();
    return {
        size: pool.length,
        available: pool.filter((e) => e.bannedUntil <= now).length,
    };
}

module.exports = {
    acquireProxy,
    reportProxy,
    poolStatus,
    parseProxyLine,
};
