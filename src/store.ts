import { MemoryCache } from "cache-hub";
import type { CacheLike, MemoryCacheOptions } from "cache-hub";

export function createMemoryResponseCacheStore(
  options: MemoryCacheOptions = {}
): CacheLike {
  return new MemoryCache(options);
}
