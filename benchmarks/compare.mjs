import { performance } from "node:perf_hooks";
import { MemoryCache } from "cache-hub";
import { readThrough } from "cache-hub/read-through";
import { createResponseCache } from "../dist/esm/index.js";

const ITERATIONS = 5_000;

async function measure(name, fn) {
  const start = performance.now();
  for (let i = 0; i < ITERATIONS; i++) {
    await fn(i);
  }
  const durationMs = performance.now() - start;
  return {
    name,
    iterations: ITERATIONS,
    durationMs: Number(durationMs.toFixed(2)),
    opsPerSecond: Math.round((ITERATIONS / durationMs) * 1000),
  };
}

const responseCache = createResponseCache({ ttl: 60_000 });
await responseCache.handle(
  { method: "GET", url: "/user/1" },
  async () => ({ status: 200, body: { id: 1 } })
);

const hubCache = new MemoryCache({ defaultTtl: 60_000 });
await readThrough(hubCache, 60_000, "user:1", async () => ({ id: 1 }));

const rows = [
  await measure("no-cache-origin", async () => ({ id: 1 })),
  await measure("response-cache-kit-hit", () =>
    responseCache.handle(
      { method: "GET", url: "/user/1" },
      async () => ({ status: 200, body: { id: 1 } })
    )
  ),
  await measure("cache-hub-read-through-hit", () =>
    readThrough(hubCache, 60_000, "user:1", async () => ({ id: 1 }))
  ),
];

console.table(rows);

console.table([
  {
    module: "response-cache-kit",
    frameworkAgnostic: true,
    responseSnapshot: true,
    sameKeySingleFlight: true,
    runtimeDependency: "cache-hub",
  },
  {
    module: "apicache",
    frameworkAgnostic: false,
    responseSnapshot: true,
    sameKeySingleFlight: "not verified",
    runtimeDependency: "package-specific",
  },
  {
    module: "express-expeditious",
    frameworkAgnostic: false,
    responseSnapshot: true,
    sameKeySingleFlight: "not verified",
    runtimeDependency: "package-specific",
  },
  {
    module: "cacheable-response",
    frameworkAgnostic: true,
    responseSnapshot: true,
    sameKeySingleFlight: "not verified",
    runtimeDependency: "package-specific",
  },
  {
    module: "@fastify/caching",
    frameworkAgnostic: false,
    responseSnapshot: false,
    sameKeySingleFlight: false,
    runtimeDependency: "fastify plugin",
  },
]);
