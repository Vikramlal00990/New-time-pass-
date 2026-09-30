'use strict';

const crypto = require('crypto');

// Multi-token auth. Configure with either:
//   authToken=abc123                                  (single token, old style)
//   AUTH_TOKENS=abc123,def456                          (comma-separated)
//   AUTH_TOKENS='[{"token":"abc123","limit":5}]'       (JSON, per-token
//                                                     concurrency limit)
// Tokens are always compared in constant time.

function parseAuthTokens() {
    const list = [];
    if (process.env.AUTH_TOKENS) {
        const raw = process.env.AUTH_TOKENS.trim();
        try {
            const arr = JSON.parse(raw);
            for (const item of [].concat(arr)) {
                if (typeof item === 'string') {
                    if (item) list.push({ token: item, limit: 0 });
                } else if (item && item.token) {
                    list.push({
                        token: String(item.token),
                        limit: Number(item.limit) || 0,
                    });
                }
            }
        } catch (e) {
            for (const t of raw.split(',')) {
                const s = t.trim();
                if (s) list.push({ token: s, limit: 0 });
            }
        }
    } else if (process.env.authToken) {
        list.push({ token: process.env.authToken, limit: 0 });
    }
    return list;
}

const tokens = parseAuthTokens();
const activePerToken = new Map(); // token string -> active request count

function enabled() {
    return tokens.length > 0;
}

// Returns { ok, entry }. entry is null when auth is disabled.
function verify(provided) {
    if (!tokens.length) return { ok: true, entry: null };
    if (typeof provided !== 'string' || !provided) return { ok: false, entry: null };
    for (const entry of tokens) {
        const a = Buffer.from(provided);
        const b = Buffer.from(entry.token);
        if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
            return { ok: true, entry };
        }
    }
    return { ok: false, entry: null };
}

// Per-token concurrency gate. Returns false when the token is at its limit.
function tokenStart(entry) {
    if (!entry || !entry.limit) return true;
    const n = activePerToken.get(entry.token) || 0;
    if (n >= entry.limit) return false;
    activePerToken.set(entry.token, n + 1);
    return true;
}

function tokenEnd(entry) {
    if (!entry || !entry.limit) return;
    const n = activePerToken.get(entry.token) || 0;
    activePerToken.set(entry.token, Math.max(0, n - 1));
}

module.exports = { enabled, verify, tokenStart, tokenEnd };
