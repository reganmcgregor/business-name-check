// Small fetch wrapper: per-host spacing, retry on 429/5xx with Retry-After, timeout.

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { version } = require('../package.json');

export const USER_AGENT = `business-name-check/${version} (+https://github.com/reganmcgregor/business-name-check)`;

const hostQueues = new Map();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Retry-After is either seconds or an HTTP date. Returns milliseconds, or null. */
function retryAfterMs(header) {
  if (!header) return null;
  const secs = Number(header);
  if (Number.isFinite(secs)) return secs * 1000;
  const when = Date.parse(header);
  return Number.isNaN(when) ? null : Math.max(0, when - Date.now());
}

export class HttpError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.body = body;
  }
}

/** Run fn after the previous call to the same host plus minDelayMs, one at a time per host. */
function spaced(host, minDelayMs, fn) {
  const prev = hostQueues.get(host) ?? Promise.resolve();
  const run = prev.then(() => fn()).finally(() => sleep(minDelayMs));
  hostQueues.set(host, run.catch(() => {}));
  return run;
}

export async function request(url, opts = {}) {
  const {
    method = 'GET',
    headers = {},
    body,
    minDelayMs = Number(process.env.BNC_MIN_DELAY_MS ?? 250),
    retries = 3,
    timeoutMs = 20000,
    deadlineMs = 90000,
  } = opts;
  const started = Date.now();
  const host = new URL(url).host;

  for (let attempt = 0; ; attempt++) {
    const res = await spaced(host, minDelayMs, async () => {
      try {
        return await fetch(url, {
          method,
          headers: { 'user-agent': USER_AGENT, accept: 'application/json', ...headers },
          body,
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        return { networkError: err };
      }
    });

    if (res.networkError) {
      if (attempt < retries && method === 'GET' && Date.now() - started + 1000 * 2 ** attempt < deadlineMs) {
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      throw new HttpError(`Network error: ${res.networkError.message}`, 0);
    }

    // Only idempotent requests are retried on 5xx. A 429 is always safe to retry.
    const retryable = res.status === 429 || (method === 'GET' && [502, 503, 504].includes(res.status));
    if (retryable && attempt < retries) {
      const fromHeader = retryAfterMs(res.headers.get('retry-after'));
      const wait = fromHeader != null ? Math.min(fromHeader, 60000) : 1000 * 2 ** attempt * 2;
      if (Date.now() - started + wait > deadlineMs) throw new HttpError(`Gave up on ${host} after ${deadlineMs / 1000}s of retries`, res.status);
      await sleep(wait);
      continue;
    }

    const text = await res.text();
    if (!res.ok) throw new HttpError(`HTTP ${res.status} from ${host}`, res.status, text.slice(0, 500));
    return { status: res.status, headers: res.headers, text, json: () => JSON.parse(text) };
  }
}
