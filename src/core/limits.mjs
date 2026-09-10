import { CAPTURE } from "../config.mjs";
import { createRateLimiter, withRetry } from "./async.mjs";

export const nominatimLimiter = createRateLimiter({
  minIntervalMs: CAPTURE.nominatimDelayMs,
  name: "nominatim",
});

export const webSearchLimiter = createRateLimiter({
  minIntervalMs: CAPTURE.webSearchDelayMs,
  name: "websearch",
});

export const overpassLimiter = createRateLimiter({
  minIntervalMs: 1200,
  name: "overpass",
});

export const retryNominatim = withRetry(
  async (fn) => nominatimLimiter.call(fn),
  { retries: 2, delayMs: 800, label: "nominatim" }
);
