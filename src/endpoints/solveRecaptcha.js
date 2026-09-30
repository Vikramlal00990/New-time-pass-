'use strict';

const { solveInvisibleWidget } = require('../module/widgetSolver');

/**
 * Solve an INVISIBLE reCAPTCHA (v3 / enterprise score): the target page is
 * replaced with a local widget page carrying the siteKey, the token is
 * harvested from the hidden cf-response input. Solved fresh on every call.
 *
 * NOTE: checkbox-style ("I'm not a robot") v2 challenges require a human
 * click and cannot be solved automatically — use this mode for invisible
 * reCAPTCHA only.
 */
async function solveRecaptcha(args) {
    return solveInvisibleWidget({
        ...args,
        template: 'recaptcha.html',
        label: 'solveRecaptcha',
    });
}

module.exports = solveRecaptcha;
