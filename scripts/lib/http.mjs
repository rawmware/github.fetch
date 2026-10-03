// fetchWithRetry + a tiny concurrency pool. Node built-ins only.

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * fetch with timeout and retries.
 * opts: {
 *   headers, timeoutMs = 10000, attempts = 2,
 *   delays = [1500]                       // ms before attempt 2, 3, ...
 *   retryStatus(res) -> bool              // default: 5xx or 429
 *   waitFor(res, attemptIndex) -> ms|null // optional header-driven wait
 *   maxWaitMs = 60000
 * }
 * Resolves to the final Response, or throws the last network error.
 */
export async function fetchWithRetry(url, opts = {}) {
  const {
    headers,
    timeoutMs = 10000,
    attempts = 2,
    delays = [1500],
    retryStatus = (res) => res.status >= 500 || res.status === 429,
    waitFor = null,
    maxWaitMs = 60000,
    fetchImpl = globalThis.fetch,
  } = opts;
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    let res = null;
    try {
      res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(timeoutMs), redirect: "follow" });
    } catch (err) {
      lastErr = err;
    }
    const last = i === attempts - 1;
    if (res && (!retryStatus(res) || last)) return res;
    if (!res && last) break;
    let wait = delays[Math.min(i, delays.length - 1)] ?? 2000;
    if (res && waitFor) {
      const w = waitFor(res, i);
      if (Number.isFinite(w)) wait = w;
      try { await res.body?.cancel(); } catch { /* ignore */ }
    } else if (res) {
      try { await res.body?.cancel(); } catch { /* ignore */ }
    }
    await sleep(Math.max(0, Math.min(wait, maxWaitMs)));
  }
  throw lastErr || new Error(`request failed: ${url}`);
}

/** Read a response body as UTF-8 text, keeping at most maxBytes. */
export async function readText(res, maxBytes) {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  while (total < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  try { await reader.cancel(); } catch { /* ignore */ }
  const buf = Buffer.concat(chunks.map((c) => Buffer.from(c.buffer, c.byteOffset, c.byteLength)));
  return buf.subarray(0, maxBytes).toString("utf8");
}

/** Run fn over items with at most n in flight. Results keep input order. */
export async function pool(items, n, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, items.length)) }, worker));
  return results;
}
