'use strict';

/**
 * Race a promise against a timeout. The timer is always cleared,
 * so no dangling handles are left behind.
 */
async function withTimeout(promise, ms, label = 'operation') {
    let timer;
    try {
        return await Promise.race([
            promise,
            new Promise((_, reject) => {
                timer = setTimeout(
                    () => reject(new Error(`${label} timed out after ${ms}ms`)),
                    ms
                );
            }),
        ]);
    } finally {
        clearTimeout(timer);
    }
}

module.exports = withTimeout;
