import { MemoryCache } from "cache-hub";
import { DistributedCacheInvalidator } from "cache-hub/distributed";
import { createRedisLeaseStore } from "cache-hub/lease";
import { MultiLevelCache } from "cache-hub/multi-level";
import { createRedisCacheAdapter } from "cache-hub/redis";
import type { CacheLike, MemoryCacheOptions } from "cache-hub";
import type {
  ResponseCacheDistributedInvalidator,
  ResponseCacheHubDistributedConfig,
  ResponseCacheHubDistributedOptions,
  ResponseCacheHubLeaseConfig,
  ResponseCacheHubLeaseOptions,
  ResponseCacheHubMemoryOptions,
  ResponseCacheHubMultiLevelOptions,
  ResponseCacheHubOptions,
  ResponseCacheHubRedisOptions,
  ResponseCacheHubRedisTargetOptions,
  ResponseCacheRuntime,
  ResponseSnapshot,
  ResolvedResponseCacheLeaseOptions,
} from "./types.js";

const DEFAULT_REDIS_URL = "redis://localhost:6379";
const NAMESPACE_TAG_PREFIX = "__response-cache-kit:namespace:";

export function createMemoryResponseCacheStore(
  options: MemoryCacheOptions = {}
): CacheLike {
  return new MemoryCache({
    ...options,
    enableTags: true,
  });
}

export function createResponseCacheNamespaceTag(namespace: string): string {
  return `${NAMESPACE_TAG_PREFIX}${namespace}`;
}

export function createResponseCacheRuntime(
  options: ResponseCacheHubOptions | undefined,
  defaultTtl: number
): ResponseCacheRuntime {
  const mode = options?.mode ?? "memory";

  if (mode === "redis") {
    return createRedisRuntime(options as ResponseCacheHubRedisOptions);
  }

  if (mode === "multi-level") {
    return createMultiLevelRuntime(
      options as ResponseCacheHubMultiLevelOptions,
      defaultTtl
    );
  }

  return createMemoryRuntime(options as ResponseCacheHubMemoryOptions, defaultTtl);
}

export async function clearResponseCacheRuntime(
  runtime: ResponseCacheRuntime,
  namespaceTag: string
): Promise<void> {
  if (runtime.distributed) {
    await runtime.distributed.invalidateTag(namespaceTag);
    return;
  }
  if (runtime.cache.invalidateByTag) {
    await runtime.cache.invalidateByTag(namespaceTag);
    return;
  }
  await runtime.cache.clear();
}

export async function invalidateResponseCacheTag(
  runtime: ResponseCacheRuntime,
  tag: string
): Promise<void> {
  if (runtime.distributed) {
    await runtime.distributed.invalidateTag(tag);
    return;
  }
  await runtime.cache.invalidateByTag?.(tag);
}

export async function setResponseSnapshot(
  cache: CacheLike,
  key: string,
  snapshot: ResponseSnapshot,
  ttl: number,
  tags: readonly string[],
  namespaceTag: string
): Promise<void> {
  const taggedCache = cache as CacheLike & {
    set(
      key: string,
      value: unknown,
      ttl?: number,
      options?: { tags?: string[] }
    ): void | Promise<void>;
  };

  const mergedTags = Array.from(new Set([...tags, namespaceTag]));
  const setOptions = { tags: mergedTags };
  await taggedCache.set(key, snapshot, ttl, setOptions);
}

function createMemoryRuntime(
  options: ResponseCacheHubMemoryOptions | undefined,
  defaultTtl: number
): ResponseCacheRuntime {
  const cache = createMemoryResponseCacheStore({
    defaultTtl,
    ...toMemoryOptions(options),
  });
  return {
    cache,
    async close() {
      cache.destroy?.();
    },
  };
}

function createRedisRuntime(
  options: ResponseCacheHubRedisOptions
): ResponseCacheRuntime {
  const cache = createRedisCacheAdapter(
    resolveRedisTarget(options),
    toRedisOptions(options)
  );
  const lease = resolveLeaseOptions(options.lease);
  const distributed = createDistributedInvalidator(options.distributed, cache);

  return {
    cache,
    ...(lease.enabled && {
      lease: lease.options,
      leaseStore: createRedisLeaseStore(cache, toLeaseStoreOptions(lease)),
    }),
    ...(distributed && { distributed }),
    async close() {
      await distributed?.close();
      await cache.close();
    },
  };
}

function createMultiLevelRuntime(
  options: ResponseCacheHubMultiLevelOptions,
  defaultTtl: number
): ResponseCacheRuntime {
  const local = createMemoryResponseCacheStore({
    defaultTtl,
    ...toMemoryOptions(options.memory),
  });
  const remote = createRedisCacheAdapter(
    resolveRedisTarget(options.redis),
    toRedisOptions(options.redis)
  );
  const cache = new MultiLevelCache({
    local,
    remote,
    ...(options.writePolicy && { writePolicy: options.writePolicy }),
    ...(options.backfillOnRemoteHit !== undefined && {
      backfillOnRemoteHit: options.backfillOnRemoteHit,
    }),
    ...(options.remoteTimeout !== undefined && {
      remoteTimeoutMs: options.remoteTimeout,
    }),
    ...(options.remoteInvalidationErrors && {
      remoteInvalidationErrors: options.remoteInvalidationErrors,
    }),
  });
  const lease = resolveLeaseOptions(options.lease);
  const distributed = createDistributedInvalidator(options.distributed, cache);

  return {
    cache,
    ...(lease.enabled && {
      lease: lease.options,
      leaseStore: createRedisLeaseStore(remote, toLeaseStoreOptions(lease)),
    }),
    ...(distributed && { distributed }),
    async close() {
      await distributed?.close();
      cache.destroy();
      await remote.close();
    },
  };
}

function toMemoryOptions(
  options: ResponseCacheHubMemoryOptions | undefined
): MemoryCacheOptions {
  return {
    ...(options?.maxEntries !== undefined && { maxEntries: options.maxEntries }),
    ...(options?.maxMemory !== undefined && { maxMemory: options.maxMemory }),
    ...(options?.enableStats !== undefined && {
      enableStats: options.enableStats,
    }),
    ...(options?.cleanupInterval !== undefined && {
      cleanupInterval: options.cleanupInterval,
    }),
    ...(options?.enabled !== undefined && { enabled: options.enabled }),
  };
}

function resolveRedisTarget(
  options: ResponseCacheHubRedisTargetOptions | undefined
): string | object {
  return options?.client ?? options?.url ?? DEFAULT_REDIS_URL;
}

function toRedisOptions(
  options: ResponseCacheHubRedisTargetOptions | undefined
) {
  return {
    ...(options?.metaKeyPrefix !== undefined && {
      metaKeyPrefix: options.metaKeyPrefix,
    }),
    ...(options?.scanCount !== undefined && { scanCount: options.scanCount }),
    ...(options?.deleteCommand !== undefined && {
      deleteCommand: options.deleteCommand,
    }),
  };
}

function resolveLeaseOptions(config: ResponseCacheHubLeaseConfig | undefined): {
  enabled: boolean;
  keyPrefix?: string;
  ownerId?: string;
  options: ResolvedResponseCacheLeaseOptions;
} {
  if (config === undefined || config === false) {
    return { enabled: false, options: { onTimeout: "fetch" } };
  }

  const options: ResponseCacheHubLeaseOptions =
    config === true ? {} : config;
  if (options.enabled === false) {
    return { enabled: false, options: { onTimeout: "fetch" } };
  }

  return {
    enabled: true,
    ...(options.keyPrefix !== undefined && { keyPrefix: options.keyPrefix }),
    ...(options.ownerId !== undefined && { ownerId: options.ownerId }),
    options: {
      ...(options.ttl !== undefined && { ttl: options.ttl }),
      ...(options.waitForOwner !== undefined && {
        waitForOwner: options.waitForOwner,
      }),
      ...(options.pollInterval !== undefined && {
        pollInterval: options.pollInterval,
      }),
      onTimeout: options.onTimeout ?? "fetch",
    },
  };
}

function toLeaseStoreOptions(lease: {
  keyPrefix?: string;
  ownerId?: string;
}): { leaseKeyPrefix?: string; ownerId?: string } {
  return {
    ...(lease.keyPrefix !== undefined && { leaseKeyPrefix: lease.keyPrefix }),
    ...(lease.ownerId !== undefined && { ownerId: lease.ownerId }),
  };
}

function createDistributedInvalidator(
  config: ResponseCacheHubDistributedConfig | undefined,
  cache: CacheLike
): ResponseCacheDistributedInvalidator | undefined {
  if (config === undefined || config === false) {
    return undefined;
  }

  const options: ResponseCacheHubDistributedOptions =
    config === true ? {} : config;
  if (options.enabled === false) {
    return undefined;
  }

  return new DistributedCacheInvalidator({
    cache,
    ...(options.redisUrl !== undefined && { redisUrl: options.redisUrl }),
    ...(options.redis !== undefined && { redis: options.redis }),
    ...(options.channel !== undefined && { channel: options.channel }),
    ...(options.instanceId !== undefined && { instanceId: options.instanceId }),
  });
}
