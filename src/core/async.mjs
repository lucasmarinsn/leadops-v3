export function createRateLimiter({ minIntervalMs, name = "limiter" }) {
  let nextAt = 0;
  let chain = Promise.resolve();

  async function schedule(fn) {
    const run = chain.then(async () => {
      const now = Date.now();
      const wait = Math.max(0, nextAt - now);
      if (wait) await new Promise((r) => setTimeout(r, wait));
      nextAt = Date.now() + minIntervalMs;
      return fn();
    });
    chain = run.catch(() => {});
    return run;
  }

  return {
    name,
    schedule,
    async call(fn) {
      return schedule(fn);
    },
  };
}

export async function mapPool(items, concurrency, worker) {
  const list = Array.isArray(items) ? items : [];
  const out = new Array(list.length);
  let i = 0;
  async function run() {
    while (i < list.length) {
      const idx = i;
      i += 1;
      out[idx] = await worker(list[idx], idx);
    }
  }
  const n = Math.max(1, Math.min(concurrency || 1, list.length || 1));
  await Promise.all(Array.from({ length: n }, () => run()));
  return out;
}

export function withRetry(fn, { retries = 2, delayMs = 700, label = "op" } = {}) {
  return async (...args) => {
    let last;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        return await fn(...args);
      } catch (err) {
        last = err;
        if (attempt >= retries) break;
        await new Promise((r) => setTimeout(r, delayMs * (attempt + 1)));
      }
    }
    const error = last || new Error(`${label} failed`);
    error.message = `${label}: ${error.message}`;
    throw error;
  };
}
