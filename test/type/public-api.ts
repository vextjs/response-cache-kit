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
