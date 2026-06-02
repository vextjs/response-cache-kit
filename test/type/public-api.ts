import { createResponseCache } from "../../src/index.js";

createResponseCache({
  ttl: 1_000,
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

// @ts-expect-error store factories are internal; users configure cacheHub.
import { createMemoryResponseCacheStore } from "../../src/index.js";
