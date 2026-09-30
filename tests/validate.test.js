process.env.NODE_ENV = 'development'
process.env.SKIP_LAUNCH = "true"
process.env.authToken = "123456"
process.env.browserLimit = -1

const server = require('../src/index')
const request = require("supertest")

test('Request Authorisation Control Test', async () => {
    return request(server)
        .post("/cf-clearance-scraper")
        .send({
            url: 'https://nopecha.com/demo/cloudflare',
            mode: "source"
        })
        .expect(401)
}, 10000)

test('Browser Context Limit Control Test', async () => {
    return request(server)
        .post("/cf-clearance-scraper")
        .send({
            url: 'https://nopecha.com/demo/cloudflare',
            mode: "source",
            authToken: "123456"
        })
        .expect(429)
}, 10000)

test('Health endpoint reports status without auth', async () => {
    return request(server)
        .get("/health")
        .expect(200)
        .then(response => {
            expect(response.body.status).toMatch(/^(ok|starting)$/)
            expect(typeof response.body.uptime).toBe('number')
            expect(typeof response.body.activeRequests).toBe('number')
        })
}, 10000)

test('Unknown proxy protocol is rejected with 400', async () => {
    return request(server)
        .post("/cf-clearance-scraper")
        .send({
            url: 'https://nopecha.com/demo/cloudflare',
            mode: "source",
            authToken: "123456",
            proxy: { protocol: "ftp", host: "127.0.0.1", port: 8080 }
        })
        .expect(400)
}, 10000)

test('Proxy without host/port is rejected with 400', async () => {
    return request(server)
        .post("/cf-clearance-scraper")
        .send({
            url: 'https://nopecha.com/demo/cloudflare',
            mode: "source",
            authToken: "123456",
            proxy: { protocol: "socks5" }
        })
        .expect(400)
}, 10000)

test('Unknown mode is rejected with 400', async () => {
    return request(server)
        .post("/cf-clearance-scraper")
        .send({
            url: 'https://nopecha.com/demo/cloudflare',
            mode: "nope",
            authToken: "123456"
        })
        .expect(400)
}, 10000)

test('Unknown route returns 404 JSON', async () => {
    return request(server)
        .get("/does-not-exist")
        .expect(404)
        .then(response => {
            expect(response.body.code).toEqual(404)
        })
}, 10000)

test('Metrics endpoint renders prometheus format without auth', async () => {
    return request(server)
        .get("/metrics")
        .expect(200)
        .then(response => {
            expect(response.text).toContain('cfcs_requests_total')
        })
}, 10000)

test('Detect mode passes validation (429 only due to test limit)', async () => {
    return request(server)
        .post("/cf-clearance-scraper")
        .send({
            url: 'https://nopecha.com/demo/cloudflare',
            mode: "detect",
            authToken: "123456"
        })
        .expect(429)
}, 10000)

test('Debug flag passes validation (429 only due to test limit)', async () => {
    return request(server)
        .post("/cf-clearance-scraper")
        .send({
            url: 'https://nopecha.com/demo/cloudflare',
            mode: "source",
            debug: true,
            authToken: "123456"
        })
        .expect(429)
}, 10000)

test('Recaptcha mode passes validation (429 only due to test limit)', async () => {
    return request(server)
        .post("/cf-clearance-scraper")
        .send({
            url: 'https://nopecha.com/demo/cloudflare',
            mode: "recaptcha",
            siteKey: "test-key",
            authToken: "123456"
        })
        .expect(429)
}, 10000)

test('Hcaptcha mode passes validation (429 only due to test limit)', async () => {
    return request(server)
        .post("/cf-clearance-scraper")
        .send({
            url: 'https://nopecha.com/demo/cloudflare',
            mode: "hcaptcha",
            siteKey: "test-key",
            authToken: "123456"
        })
        .expect(429)
}, 10000)

test('Timeout/headers/async pass validation (429 only due to test limit)', async () => {
    return request(server)
        .post("/cf-clearance-scraper")
        .send({
            url: 'https://nopecha.com/demo/cloudflare',
            mode: "detect",
            timeout: 30000,
            headers: { "X-Test": "1" },
            authToken: "123456"
        })
        .expect(429)
}, 10000)

test('Bad timeout is rejected with 400', async () => {
    return request(server)
        .post("/cf-clearance-scraper")
        .send({
            url: 'https://nopecha.com/demo/cloudflare',
            mode: "detect",
            timeout: 100,
            authToken: "123456"
        })
        .expect(400)
}, 10000)

test('Bad webhookUrl is rejected with 400', async () => {
    return request(server)
        .post("/cf-clearance-scraper")
        .send({
            url: 'https://nopecha.com/demo/cloudflare',
            mode: "detect",
            async: true,
            webhookUrl: "not-a-uri",
            authToken: "123456"
        })
        .expect(400)
}, 10000)
