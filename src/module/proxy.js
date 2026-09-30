'use strict';

const SUPPORTED_PROTOCOLS = ['http', 'https', 'socks4', 'socks5'];

/**
 * Build a puppeteer proxyServer string from the request's proxy object.
 * Supports http/https/socks4/socks5. Returns undefined when no proxy given.
 */
function buildProxyServer(proxy) {
    if (!proxy) return undefined;
    const protocol = String(proxy.protocol || 'http').toLowerCase();
    if (!SUPPORTED_PROTOCOLS.includes(protocol)) {
        throw new Error(
            `Unsupported proxy protocol "${proxy.protocol}". ` +
            `Use one of: ${SUPPORTED_PROTOCOLS.join(', ')}`
        );
    }
    if (!proxy.host || !proxy.port) {
        throw new Error('Proxy needs both "host" and "port"');
    }
    return `${protocol}://${proxy.host}:${proxy.port}`;
}

/**
 * Apply proxy username/password auth to a page, when supplied.
 */
async function applyProxyAuth(page, proxy) {
    if (proxy && proxy.username && proxy.password) {
        await page.authenticate({
            username: proxy.username,
            password: proxy.password,
        });
    }
}

module.exports = { buildProxyServer, applyProxyAuth, SUPPORTED_PROTOCOLS };
