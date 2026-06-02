import { performance } from "node:perf_hooks";
import { createResponseCache } from "../dist/esm/index.js";

async function measure(name, iterations, fn) {
  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    await fn(i);
  }
  const durationMs = performance.now() - start;
  const opsPerSecond = Math.round((iterations / durationMs) * 1000);
  return {
    name,
    iterations,
    durationMs: Number(durationMs.toFixed(2)),
    opsPerSecond,
  };
}

const cache = createResponseCache({ ttl: 60_000 });
let originCalls = 0;
const origin = async () => {
  originCalls++;
  return {
    status: 200,
    headers: { "content-type": "application/json" },
    body: { ok: true, originCalls },
  };
};

await cache.handle({ method: "GET", url: "/hot" }, origin);

const hit = await measure("response-cache-hit", 10_000, () =>
  cache.handle({ method: "GET", url: "/hot" }, origin)
);

const keyBuild = await measure("response-cache-key-build", 25_000, (i) => {
  cache.makeKey({
    method: "GET",
    url: `/items?b=${i % 3}&a=${i % 5}`,
    headers: { "accept-language": "en-US" },
  });
});

const raceCache = createResponseCache({ ttl: 1 });
await raceCache.handle({ method: "GET", url: "/race" }, origin);
await new Promise((resolve) => setTimeout(resolve, 3));
const beforeRace = originCalls;
const raceStart = performance.now();
const concurrentRequests = 10_000;
await Promise.all(
  Array.from({ length: concurrentRequests }, () =>
    raceCache.handle({ method: "GET", url: "/race" }, origin)
  )
);
const raceDurationMs = performance.now() - raceStart;

console.table([
  hit,
  keyBuild,
  {
    name: "expired-race-10000-same-key",
    iterations: concurrentRequests,
    durationMs: Number(raceDurationMs.toFixed(2)),
    opsPerSecond: Math.round((concurrentRequests / raceDurationMs) * 1000),
    originCalls: originCalls - beforeRace,
  },
]);
