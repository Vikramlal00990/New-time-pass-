'use strict';

const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const { SUPPORTED_PROTOCOLS } = require('./proxy');

const ajv = new Ajv();
addFormats(ajv);

const schema = {
    type: 'object',
    properties: {
        mode: {
            type: 'string',
            enum: [
                'source',
                'turnstile-min',
                'turnstile-max',
                'waf-session',
                'detect',
                'recaptcha',
                'recaptcha-v3',
                'recaptcha-enterprise',
                'recaptcha-v2',
                'hcaptcha',
            ],
        },
        proxy: {
            type: 'object',
            properties: {
                protocol: { type: 'string', enum: SUPPORTED_PROTOCOLS },
                host: { type: 'string' },
                port: { type: 'integer' },
                username: { type: 'string' },
                password: { type: 'string' },
            },
            required: ['host', 'port'],
            additionalProperties: false,
        },
        url: {
            type: 'string',
            format: 'uri',
        },
        authToken: {
            type: 'string',
        },
        siteKey: {
            type: 'string',
        },
        debug: {
            type: 'boolean',
        },
        // Turbo: reuse a warm page for turnstile-min (fresh token every call)
        turbo: {
            type: 'boolean',
        },
        // Async job: return a jobId immediately, result via GET /jobs/:id
        async: {
            type: 'boolean',
        },
        // Webhook POSTed when an async job finishes
        webhookUrl: {
            type: 'string',
            format: 'uri',
        },
        // Per-request timeout in ms (overrides global timeOut)
        timeout: {
            type: 'integer',
            minimum: 1000,
            maximum: 600000,
        },
        // Custom headers sent with the browser session
        headers: {
            type: 'object',
            additionalProperties: { type: 'string' },
        },
        // Bulk endpoint: number of tokens (1-10)
        count: {
            type: 'integer',
            minimum: 1,
            maximum: 10,
        },
        // reCAPTCHA v3 action name
        action: {
            type: 'string',
        },
        // reCAPTCHA v2 invisible mode
        invisible: {
            type: 'boolean',
        },
    },
    required: ['mode', 'url'],
    additionalProperties: false,
};

function validate(data) {
    const valid = ajv.validate(schema, data);
    if (!valid) return ajv.errors;
    return true;
}

module.exports = validate;
