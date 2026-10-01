'use strict';

// Injected into the warm page via page.evaluate (not via HTML <script> tags,
// so we don't depend on parser script execution timing).
window.__turboSolve = function (siteKey, timeoutMs) {
    return new Promise(function (resolve, reject) {
        var done = false;
        var slot = document.getElementById('turbo-slot');
        if (!slot) {
            reject(new Error('Turbo slot missing'));
            return;
        }
        slot.innerHTML = '';
        var timer = setTimeout(function () {
            if (!done) {
                done = true;
                try { turnstile.reset(); } catch (e) {}
                reject(new Error('Turbo widget timeout'));
            }
        }, timeoutMs || 30000);
        function finish(ok, val) {
            if (done) return;
            done = true;
            clearTimeout(timer);
            try { turnstile.reset(); } catch (e) {}
            slot.innerHTML = '';
            if (ok) resolve(val); else reject(val);
        }
        try {
            turnstile.render(slot, {
                sitekey: siteKey,
                callback: function (token) { finish(true, token); },
                'expired-callback': function () { finish(false, new Error('Turbo token expired')); },
                'error-callback': function () { finish(false, new Error('Turbo widget error')); },
            });
        } catch (e) {
            finish(false, e);
        }
    });
};
