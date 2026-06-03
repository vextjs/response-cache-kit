import { MemoryCache } from "cache-hub";
import type { CacheLike, MemoryCacheOptions } from "cache-hub";
import type { ResponseSnapshot } from "./types.js";

export function createMemoryResponseCacheStore(
  options: MemoryCacheOptions = {}
): CacheLike {
  return new MemoryCache({
    ...options,
    enableTags: true,
  });
}

export async function setResponseSnapshot(
  cache: CacheLike,
  key: string,
  snapshot: ResponseSnapshot,
  ttl: number,
  tags: readonly string[]
): Promise<void> {
  const taggedCache = cache as CacheLike & {
    set(
      key: string,
      value: unknown,
      ttl?: number,
      options?: { tags?: string[] }
    ): void | Promise<void>;
  };

  const setOptions = tags.length > 0 ? { tags: Array.from(tags) } : undefined;
  await taggedCache.set(key, snapshot, ttl, setOptions);
}
