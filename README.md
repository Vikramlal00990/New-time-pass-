> [!WARNING]
> This repo will no longer receive updates. Thank you to everyone who supported it.

# CF Clearance Scraper

This library was created for testing and training purposes to retrieve the page source of websites, create Cloudflare Turnstile tokens and create Cloudflare WAF sessions.

Cloudflare protection not only checks cookies in the request. It also checks variables in the header. For this reason, it is recommended to use it with the sample code in this readme file.

Cookies with cf in the name belong to Cloudflare. You can find out what these cookies do and how long they are valid by **[Clicking Here](https://developers.cloudflare.com/fundamentals/reference/policies-compliances/cloudflare-cookies/)**.

## Sponsor

[![ScrapeDo](src/data/sdo.gif)](https://scrape.do/?utm_source=github&utm_medium=repo_ccs)

## Installation

Installation with Docker is recommended.

**Docker**

Please make sure you have installed the latest image. If you get an error, try downloading the latest version by going to Docker Hub.

```bash
sudo docker rmi zfcsoftware/cf-clearance-scraper:latest --force
```

```bash
docker run -d -p 3000:3000 \
-e PORT=3000 \
-e browserLimit=20 \
-e timeOut=60000 \
zfcsoftware/cf-clearance-scraper:latest
```

**Github**

```bash
git clone https://github.com/zfcsoftware/cf-clearance-scraper
cd cf-clearance-scraper
npm install
npm run start
```

## Create Cloudflare WAF Session

By creating a session as in the example, you can send multiple requests to the same site without being blocked. Since sites may have TLS protection, it is recommended to send requests with the library in the example.

```js
const initCycleTLS = require('cycletls');
async function test() {
    const session = await fetch('http://localhost:3000/cf-clearance-scraper', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            url: 'https://nopecha.com/demo/cloudflare',
            mode: "waf-session",
            // proxy:{
            //     host: '127.0.0.1',
            //     port: 3000,
            //     username: 'username',
            //     password: 'password'
            // }
        })
    }).then(res => res.json()).catch(err => { console.error(err); return null });

    if (!session || session.code != 200) return console.error(session);

    const cycleTLS = await initCycleTLS();
    const response = await cycleTLS('https://nopecha.com/demo/cloudflare', {
        body: '',
        ja3: '772,4865-4866-4867-49195-49199-49196-49200-52393-52392-49171-49172-156-157-47-53,23-27-65037-43-51-45-16-11-13-17513-5-18-65281-0-10-35,25497-29-23-24,0', // https://scrapfly.io/web-scraping-tools/ja3-fingerprint
        userAgent: session.headers["user-agent"],
        // proxy: 'http://username:password@hostname.com:443',
        headers: {
            ...session.headers,
            cookie: session.cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ')
        }
    }, 'get');

    console.log(response.status);
    cycleTLS.exit().catch(err => { });
}
test()
```

## Create Turnstile Token with Little Resource Consumption

This endpoint allows you to generate tokens for a Cloudflare Turnstile Captcha. It blocks the request that fetches the page resource and instead makes the page resource a simple Turnstile render page. This allows you to generate tokens without having to load any additional css or js files. 

However, in this method, the siteKey variable must be sent to Turnstile along with the site to create the token. If this does not work, you can examine the token generation system by loading the full page resource described in the next section.

```js
fetch('http://localhost:3000/cf-clearance-scraper', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json'
    },
    body: JSON.stringify({
        url: 'https://turnstile.zeroclover.io/',
        siteKey: "0x4AAAAAAAEwzhD6pyKkgXC0",
        mode: "turnstile-min",
        // proxy:{
        //     host: '127.0.0.1',
        //     port: 3000,
        //     username: 'username',
        //     password: 'password'
        // }
    })
})
    .then(res => res.json())
    .then(console.log)
    .catch(console.log);
```

## Creating Turnstile Token with Full Page Load

This example request goes to the page at the given url address with a real browser, resolves the Turnstile and returns you the token.

```js
fetch('http://localhost:3000/cf-clearance-scraper', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json'
    },
    body: JSON.stringify({
        url: 'https://turnstile.zeroclover.io/',
        mode: "turnstile-max",
        // proxy:{
        //     host: '127.0.0.1',
        //     port: 3000,
        //     username: 'username',
        //     password: 'password'
        // }
    })
})
    .then(res => res.json())
    .then(console.log)
    .catch(console.log);
```

## Getting Page Source from a Site Protected with Cloudflare WAF

With this request you can scrape the page source of a website protected with CF WAF.

```js
fetch('http://localhost:3000/cf-clearance-scraper', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json'
    },
    body: JSON.stringify({
        url: 'https://nopecha.com/demo/cloudflare',
        mode: "source"
        // proxy:{
        //     host: '127.0.0.1',
        //     port: 3000,
        //     username: 'username',
        //     password: 'password'
        // }
    })
})
    .then(res => res.json())
    .then(console.log)
    .catch(console.log);
```

## Quick Questions and Answers

### Does It Open A New Browser On Every Request?
No, a new context is started with each request and closed when the job is finished. Processes are executed with isolated contexts through a single browser.

### How Do I Limit the Browser Context to Open?
Set the `browserLimit` env var (default `20`). Requests beyond the limit get a fast `429` instead of queueing.

### How Do I Add Authentication to Api?
Set the `authToken` env var. Every request must then include the same `authToken` in its body, otherwise it gets `401`. Tokens are compared in constant time.

### How Do I Set The Timeout Time?
Set the `timeOut` env var in milliseconds (default `60000`).

### Health check
`GET /health` returns `{ status, uptime, activeRequests, browserLimit, queued, jobs, proxyPool, version }` with no auth. `status` is `starting` until the browser is ready, then `ok`. Use it for Docker healthchecks and load balancers.

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `browserLimit` | `20` | Max concurrent browser contexts (else `429`, or queued if `REQUEST_QUEUE=true`) |
| `timeOut` | `60000` | Per-request timeout in ms (overridable per request) |
| `authToken` | — | If set, required in every request body (single token) |
| `AUTH_TOKENS` | — | Multiple tokens: `a,b,c` or JSON `[{"token":"a","limit":5}]` (per-token concurrency limit) |
| `HEADLESS` | `false` | Set `true` to run Chrome headless (no Xvfb) |
| `CHROME_PATH` | auto-detected | Path to Chrome/Chromium. Not needed in Docker (Chrome is baked into the image); on other hosts the server auto-detects common install locations |
| `CHROME_ARGS` | — | Extra Chrome flags, space-separated, e.g. `--no-sandbox --proxy-server=http://127.0.0.1:8080` |
| `BODY_LIMIT` | `1mb` | Max JSON body size |
| `CORS_ORIGIN` | — | If set, CORS is restricted to this origin |
| `SHUTDOWN_TIMEOUT_MS` | `10000` | Max wait for graceful shutdown on SIGTERM/SIGINT |
| `SKIP_LAUNCH` | — | Set `true` to skip browser launch (tests) |
| `MAX_ATTEMPTS` | `2` | Total attempts per request (fresh solve each time — a new token is produced on every attempt, never cached) |
| `RETRY_BACKOFF_MS` | `2000` | Base backoff between attempts (multiplied by attempt number) |
| `PROXY_POOL` | — | JSON array of proxies, e.g. `[{"protocol":"socks5","host":"1.2.3.4","port":1080}]` |
| `PROXY_FILE` | — | Path to a proxy list file (one per line, see formats below) |
| `PROXY_MAX_FAILS` | `3` | Consecutive failures before a pool proxy is banned |
| `PROXY_BAN_MS` | `300000` | How long a failed pool proxy stays banned (5 min) |
| `REQUEST_QUEUE` | `false` | Set `true` to queue over-limit requests instead of returning `429` |
| `QUEUE_MAX_WAIT_MS` | `120000` | How long a queued request waits for a browser slot (else `503`) |
| `turbo` (request) | `false` | `turnstile-min` + `"turbo": true` reuses a warm page (api.js preloaded, Cloudflare session live) and renders a fresh widget per call — much faster. Every token is freshly issued; only the page/session is reused. Falls back to a normal solve automatically if no warm page is free |
| `TURBO_WARM_PAGES` | `3` | Warm pages kept per site (origin). First turbo request warms up (~seconds), following ones are fast |
| `FINGERPRINT_ROTATION` | `true` | Rotate user-agent / viewport / timezone / locale per request |
| `BROWSER_MAX_SOLVES` | `0` | Restart the browser every N solves (`0` = disabled) |
| `JOB_TTL_MS` | `3600000` | How long async job results are kept |

## Proxy support

The `proxy` object now supports a `protocol` field:

```json
{
    "url": "https://example.com",
    "mode": "waf-session",
    "proxy": {
        "protocol": "socks5",
        "host": "127.0.0.1",
        "port": 1080,
        "username": "user",
        "password": "pass"
    }
}
```

`protocol` is one of `http` (default), `https`, `socks4`, `socks5`. `host` and `port` are required when `proxy` is given.

### Proxy pool (auto-rotation)

Instead of sending one proxy per request, configure a pool and the server rotates it automatically — a different proxy per request, and dead proxies get banned for `PROXY_BAN_MS` after `PROXY_MAX_FAILS` consecutive failures:

```bash
# JSON array in env
PROXY_POOL='[{"protocol":"socks5","host":"1.2.3.4","port":1080,"username":"u","password":"p"}]'

# ...or a file, one proxy per line
PROXY_FILE=/app/proxies.txt
```

`proxies.txt` line formats (blank lines and `#` comments ignored):

```
socks5://user:pass@1.2.3.4:1080
http://5.6.7.8:8080
9.10.11.12:3128:user:pass
13.14.15.16:8080
```

A per-request `proxy` in the body always wins over the pool. `/health` shows the pool status (`size` / `available`).

## Fresh tokens, auto-retry

Every attempt solves the challenge from scratch — tokens and sessions are never cached, so **every request returns a new token**. If an attempt fails, the server retries up to `MAX_ATTEMPTS` times (default 2), each retry with a fresh browser context and a different pool proxy, with linear backoff (`RETRY_BACKOFF_MS` × attempt). The response includes `attempts` so you can see how many tries it took.

## Debug screenshots

Add `"debug": true` to any request. If the solve fails, the response includes a base64 `screenshot` of the page at failure time, and the PNG is also saved under `debug/fail_<mode>_<timestamp>.png` on the server — so you can see exactly what the challenge page showed.

## Detect mode

`mode: "detect"` loads the URL without solving anything and reports what protection it has:

```json
{ "protected": true, "types": ["cloudflare-waf", "turnstile"], "title": "Just a moment...", "code": 200 }
```

Use it to pick the right mode before spending a full solve.

## Metrics

`GET /metrics` exposes Prometheus-format metrics (no auth): per-mode request counts and statuses, average durations, active requests, retries, and pool-proxy failures. Point Prometheus/Grafana at it.

## Async jobs + webhook

For long solves, set `"async": true` — the server returns `202` immediately with a `jobId`:

```json
{ "code": 202, "jobId": "job_muophhch0dru5jx", "status": "queued" }
```

Poll `GET /jobs/:id` for the result (`queued` → `running` → `done` / `error`). Add `"webhookUrl": "https://your.app/hook"` and the finished job is POSTed there:

```json
{ "jobId": "...", "status": "done", "result": { "token": "...", "attempts": 1 }, "error": null }
```

## reCAPTCHA / hCaptcha modes

`mode: "recaptcha"` and `mode: "hcaptcha"` solve **invisible** widgets (v3 / enterprise-score style) using your `siteKey`, exactly like `turnstile-min`:

```json
{ "url": "https://example.com/", "mode": "recaptcha", "siteKey": "YOUR_SITE_KEY" }
```

Note: visible checkbox challenges ("I'm not a robot") need a human click and can't be solved automatically.

## Fingerprint rotation

Every request gets a fresh, consistent device profile: random user-agent, viewport, timezone and locale (e.g. Pixel 8 + `Asia/Karachi` + `ur-PK`, or Windows Chrome + `Europe/Berlin` + `de-DE`). Disable with `FINGERPRINT_ROTATION=false`.

## Request queue

With `REQUEST_QUEUE=true`, over-limit requests wait for a browser slot (up to `QUEUE_MAX_WAIT_MS`) instead of getting an immediate `429`. If no slot frees in time, the server answers `503`.

## Per-request timeout & custom headers

```json
{
    "url": "https://example.com/",
    "mode": "waf-session",
    "timeout": 30000,
    "headers": { "Referer": "https://example.com/", "X-Custom": "1" }
}
```

`timeout` overrides the global `timeOut` for that request; `headers` are sent with the browser session.

## Multi-token auth

Give out separate API keys, each with its own concurrency cap:

```bash
AUTH_TOKENS='[{"token":"key-for-alice","limit":5},{"token":"key-for-bob"}]'
# or simply: AUTH_TOKENS='key1,key2,key3'
```

Tokens are compared in constant time. A token over its `limit` gets `429`.

## Browser auto-restart

`BROWSER_MAX_SOLVES=200` restarts Chrome every 200 solves (only when idle, so live requests never die) — fights memory leaks and fingerprint buildup on long-running instances.

## Hardening notes

- `waitForResponse` uses bounded timeouts and can never dangle: a failed navigation can't crash the process.
- A global `unhandledRejection` guard logs stray CDP errors instead of killing the API server.

## Speed notes (v3)

- Images, fonts and media are blocked on every page — challenge solving only needs the document and scripts.
- The `Accept-Language` probe runs once per process and is cached (it used to hit httpbin.org on every request).
- No-op request interception was removed from the `source` and `waf-session` paths.
- Over-limit requests fail fast with `429` instead of piling up.

## Disclaimer of Liability
This repository was created purely for testing and training purposes. The user is responsible for any prohibited liability that may arise from its use.
The library is not intended to harm any site or company. The user is responsible for any damage that may arise. 
Users of this repository are deemed to have accepted this disclaimer. 
