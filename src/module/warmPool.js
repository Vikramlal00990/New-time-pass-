'use strict';

const fs = require('fs');
const path = require('path');
const { newContext, setupPage, BLOCKED_TYPES } = require('./browserContext');

// Warm page pool for TURBO Turnstile solves.
//
// A warm page keeps challenges.cloudflare.com/api.js loaded and a live
// Cloudflare session. Each turbo request renders a BRAND-NEW widget on the
// warm page and harvests a freshly issued token — tokens are never cached
// or reused. Only the page/session is reused, which is what makes turbo fast
// (no context creation, no navigation, no api.js download per request).
//
// Pool key = origin + proxy, so domain-bound siteKeys always solve on the
// right origin and proxied requests never share a direct page.

const MAX_WARM_PER_ORIGIN = Number(process.env.TURBO_WARM_PAGES) || 3;
const ACQUIRE_TIMEOUT_MS = Number(process.env.TURBO_ACQUIRE_MS) || 10000;

const pools = new Map(); // key -> { slots: [{page, context, busy, fails}], waiters: [] }

function poolKey(url, proxy) {
    const origin = new URL(url).origin;
    const p = proxy ? `${proxy.protocol || 'http'}://${proxy.host}:${proxy.port}` : 'direct';
    return `${origin}|${p}`;
}

function getPool(key) {
    let pool = pools.get(key);
    if (!pool) {
        pool = { slots: [], waiters: [] };
        pools.set(key, pool);
    }
    return pool;
}

async function createWarmSlot(url, proxy) {
    const context = await newContext(proxy);
    const page = await context.newPage();
    await setupPage(page, proxy, {});
    const template = String(
        fs.readFileSync(path.join(__dirname, '..', 'data', 'turboPage.html'))
    );
    await page.setRequestInterception(true);
    page.on('request', (request) => {
        try {
            if (
                [url, url + '/'].includes(request.url()) &&
                request.resourceType() === 'document'
            ) {
                request.respond({
                    status: 200,
                    contentType: 'text/html',
                    body: template,
                });
            } else if (BLOCKED_TYPES.has(request.resourceType())) {
                request.abort();
            } else {
                request.continue();
            }
        } catch (e) {
            // page may already be closed — ignore
        }
    });
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
        () => window.turnstile && window.__turboSolve,
        { timeout: 30000 }
    );
    return { page, context, busy: false, fails: 0 };
}

async function destroySlot(slot) {
    try { await slot.context.close(); } catch (e) { /* ignore */ }
}

/**
 * Acquire a warm page for this url/proxy. Resolves with { slot, release }
 * or null when no warm page is available in time (caller should fall back
 * to a normal fresh-context solve).
 */
async function acquire(url, proxy) {
    const key = poolKey(url, proxy);
    const pool = getPool(key);

    const tryTake = () => {
        for (const slot of pool.slots) {
            if (!slot.busy && !slot.page.isClosed()) {
                slot.busy = true;
                return slot;
            }
        }
        return null;
    };

    // Drop dead slots
    for (let i = pool.slots.length - 1; i >= 0; i--) {
        if (pool.slots[i].page.isClosed()) {
            const [dead] = pool.slots.splice(i, 1);
            destroySlot(dead);
        }
    }

    let slot = tryTake();
    if (!slot && pool.slots.length < MAX_WARM_PER_ORIGIN) {
        try {
            slot = await createWarmSlot(url, proxy);
            slot.busy = true;
            pool.slots.push(slot);
        } catch (e) {
            slot = null; // warmup failed — caller falls back
        }
    }
    if (slot) {
        return { slot, release: () => releaseSlot(pool, slot) };
    }
    if (pool.slots.length < MAX_WARM_PER_ORIGIN) {
        return null; // warmup failed and pool not full — nothing to wait for
    }

    // Pool full and all warm pages busy — wait briefly for one to free up
    return new Promise((resolve) => {
        const timer = setTimeout(() => {
            const i = pool.waiters.indexOf(onFree);
            if (i >= 0) pool.waiters.splice(i, 1);
            resolve(null); // timed out — caller falls back to normal solve
        }, ACQUIRE_TIMEOUT_MS);
        const onFree = (s) => {
            clearTimeout(timer);
            resolve({ slot: s, release: () => releaseSlot(pool, s) });
        };
        pool.waiters.push(onFree);
    });
}

function releaseSlot(pool, slot) {
    slot.busy = false;
    const waiter = pool.waiters.shift();
    if (waiter) {
        slot.busy = true;
        waiter(slot);
    }
}

/** Mark a slot bad (widget kept failing) so it gets rebuilt next time. */
async function invalidate(slot, url, proxy) {
    const key = poolKey(url, proxy);
    const pool = pools.get(key);
    slot.fails += 1;
    if (slot.fails >= 2 && pool) {
        const i = pool.slots.indexOf(slot);
        if (i >= 0) pool.slots.splice(i, 1);
        await destroySlot(slot);
    }
}

module.exports = { acquire, invalidate, poolKey, _pools: pools };
