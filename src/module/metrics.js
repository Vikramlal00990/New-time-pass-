'use strict';

// Minimal in-memory metrics, rendered in Prometheus text format.
// No dependencies.

const counts = new Map(); // "mode|status" -> n
const durations = new Map(); // mode -> { totalMs, n }
let active = 0;
let retries = 0;
let proxyFailures = 0;

function requestStarted() {
    active += 1;
}

function requestFinished(mode, ok, ms) {
    active = Math.max(0, active - 1);
    const key = `${mode}|${ok ? 'ok' : 'error'}`;
    counts.set(key, (counts.get(key) || 0) + 1);
    const d = durations.get(mode) || { totalMs: 0, n: 0 };
    d.totalMs += ms;
    d.n += 1;
    durations.set(mode, d);
}

function retried() {
    retries += 1;
}

function proxyFailed() {
    proxyFailures += 1;
}

function renderPrometheus() {
    const lines = [
        '# HELP cfcs_requests_total Total scraper requests by mode and status.',
        '# TYPE cfcs_requests_total counter',
    ];
    for (const [key, n] of counts) {
        const [mode, status] = key.split('|');
        lines.push(`cfcs_requests_total{mode="${mode}",status="${status}"} ${n}`);
    }
    lines.push(
        '# HELP cfcs_request_duration_ms_total Total request time by mode.',
        '# TYPE cfcs_request_duration_ms_total counter'
    );
    for (const [mode, d] of durations) {
        lines.push(`cfcs_request_duration_ms_total{mode="${mode}"} ${Math.round(d.totalMs)}`);
    }
    lines.push(
        '# HELP cfcs_request_avg_duration_ms Average request time by mode.',
        '# TYPE cfcs_request_avg_duration_ms gauge'
    );
    for (const [mode, d] of durations) {
        lines.push(
            `cfcs_request_avg_duration_ms{mode="${mode}"} ${Math.round(d.totalMs / Math.max(1, d.n))}`
        );
    }
    lines.push(
        '# HELP cfcs_active_requests Currently running requests.',
        '# TYPE cfcs_active_requests gauge',
        `cfcs_active_requests ${active}`,
        '# HELP cfcs_retries_total Total retry attempts.',
        '# TYPE cfcs_retries_total counter',
        `cfcs_retries_total ${retries}`,
        '# HELP cfcs_proxy_failures_total Total pool-proxy failures.',
        '# TYPE cfcs_proxy_failures_total counter',
        `cfcs_proxy_failures_total ${proxyFailures}`
    );
    return lines.join('\n') + '\n';
}

module.exports = {
    requestStarted,
    requestFinished,
    retried,
    proxyFailed,
    renderPrometheus,
};
