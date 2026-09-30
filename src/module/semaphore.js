'use strict';

// Fair async semaphore over browser contexts. The limit tracks
// global.browserLimit dynamically so env/test changes apply live.
// Slot waiters are served FIFO; a released slot transfers directly to
// the next waiter instead of being dropped.

class Semaphore {
    constructor() {
        this.current = 0;
        this.waiters = [];
    }

    get max() {
        const m = Number(global.browserLimit);
        return Number.isFinite(m) ? m : 20;
    }

    _sync() {
        global.browserLength = this.current;
    }

    tryAcquire() {
        if (this.current < this.max) {
            this.current += 1;
            this._sync();
            return true;
        }
        return false;
    }

    acquire(timeoutMs) {
        if (this.tryAcquire()) return Promise.resolve(true);
        if (!timeoutMs || timeoutMs <= 0) return Promise.resolve(false);
        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                const i = this.waiters.indexOf(done);
                if (i !== -1) this.waiters.splice(i, 1);
                resolve(false);
            }, timeoutMs);
            const done = () => {
                clearTimeout(timer);
                resolve(true);
            };
            this.waiters.push(done);
        });
    }

    release() {
        const next = this.waiters.shift();
        if (next) {
            // slot transfers to the waiter; current stays the same
            next();
        } else {
            this.current = Math.max(0, this.current - 1);
            this._sync();
        }
    }

    get queued() {
        return this.waiters.length;
    }
}

module.exports = new Semaphore();
