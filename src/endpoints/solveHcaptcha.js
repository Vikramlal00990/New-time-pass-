'use strict';

const { solveInvisibleWidget } = require('../module/widgetSolver');

/**
 * Solve an INVISIBLE hCaptcha: the target page is replaced with a local
 * widget page carrying the siteKey, the token is harvested from the
 * hidden cf-response input. Solved fresh on every call.
 *
 * NOTE: visible checkbox challenges require a human click and cannot be
 * solved automatically — use this mode for invisible hCaptcha only.
 */
async function solveHcaptcha(args) {
    return solveInvisibleWidget({
        ...args,
        template: 'hcaptcha.html',
        label: 'solveHcaptcha',
    });
}

module.exports = solveHcaptcha;
