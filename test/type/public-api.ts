import {
  createResponseCache,
  createResponseCacheHeaders,
  createResponseCacheWritePayload,
  createVextResponseCacheOptions,
  normalizeResponseCacheRequest,
} from "../../src/index.js";

createResponseCache({
  ttl: 1_000,
  tags: ["products"],
  vary: "*",
  cacheHub: {
    maxEntries: 100,
    enableStats: true,
  },
});

createResponseCache({
  ttl: 1_000,
  cacheHub: {
    mode: "redis",
    client: {},
    metaKeyPrefix: "app:response-cache",
    scanCount: 100,
    deleteCommand: "unlink",
    lease: {
      ttl: 500,
      waitForOwner: 600,
      pollInterval: 10,
      onTimeout: "fetch",
      keyPrefix: "app:lease",
      ownerId: "worker-a",
    },
    distributed: {
      redisUrl: "redis://localhost:6379",
      channel: "app:response-cache:invalidate",
      instanceId: "worker-a",
    },
  },
});

createResponseCache({
  ttl: 1_000,
  cacheHub: {
    mode: "multi-level",
    memory: { maxEntries: 100 },
    redis: { client: {} },
    writePolicy: "both",
    backfillOnRemoteHit: true,
    remoteTimeout: 50,
    remoteInvalidationErrors: "ignore",
    lease: true,
    distributed: false,
  },
});

createResponseCache({
  ttl: 1_000,
  cacheHub: {
    // @ts-expect-error response TTL is controlled by response-cache-kit.
    defaultTtl: 1_000,
  },
});

createResponseCache({
  ttl: 1_000,
  // @ts-expect-error custom cache injection is not part of the public API.
  cache: {},
});

const cache = createResponseCache();
await cache.delete("key");
await cache.invalidateTag("tag");
await cache.getRemainingTtl("key");
await cache.close?.();
cache.stats();

const request = normalizeResponseCacheRequest({
  method: "GET",
  url: "/x",
  partitionKey: "tenant:1",
});
const result = await cache.handle(request, async () => ({ body: "ok" }));
createResponseCacheHeaders(result, { cacheControl: true });
createResponseCacheWritePayload(result, { cacheHeaderName: "X-Cache" });
createVextResponseCacheOptions({ ttl: 2, tags: ["products"] });

// @ts-expect-error store factories are internal; users configure cacheHub.
import { createMemoryResponseCacheStore } from "../../src/index.js";
