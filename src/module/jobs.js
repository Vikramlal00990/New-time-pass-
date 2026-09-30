'use strict';

// In-memory async job store for mode:"async" requests.
// Jobs live until JOB_TTL_MS after creation; a sweeper removes the stale ones.

const JOB_TTL_MS = Number(process.env.JOB_TTL_MS) || 3600000;

const jobs = new Map();
let seq = 0;

function createJob(data) {
    const id =
        `job_${Date.now().toString(36)}` +
        `${(seq++).toString(36)}` +
        Math.random().toString(36).slice(2, 8);
    const job = {
        id,
        status: 'queued', // queued -> running -> done | error
        data,
        result: null,
        error: null,
        screenshot: null,
        attempts: 0,
        createdAt: Date.now(),
        webhookUrl: data.webhookUrl || null,
    };
    jobs.set(id, job);
    return job;
}

function getJob(id) {
    return jobs.get(id) || null;
}

function jobCount() {
    return jobs.size;
}

function scheduleCleanup(id) {
    setTimeout(() => {
        jobs.delete(id);
    }, JOB_TTL_MS).unref();
}

setInterval(() => {
    const now = Date.now();
    for (const [id, job] of jobs) {
        if (now - job.createdAt > JOB_TTL_MS) jobs.delete(id);
    }
}, 60000).unref();

module.exports = { createJob, getJob, jobCount, scheduleCleanup };
