import {
  clearResponseCacheRuntime,
  createResponseCacheNamespaceTag,
  createResponseCacheRuntime,
  invalidateResponseCacheTag,
  setResponseSnapshot,
} from "./store.js";
import { createResponseCacheKey } from "./key.js";
import {
  DEFAULT_CACHEABLE_METHODS,
  DEFAULT_CACHEABLE_STATUSES,
  evaluateRequestPolicy,
  evaluateResponsePolicy,
} from "./policy.js";
import { normalizeHeaders } from "./headers.js";
import {
  createResponseSnapshot,
  originToResult,
  restoreSnapshot,
} from "./snapshot.js";
import { SingleFlight } from "./single-flight.js";
import type {
  ResolvedResponseCacheOptions,
  ResponseCache,
  ResponseCacheHandleOptions,
  ResponseCacheMetadata,
  ResponseCacheOptions,
  ResponseCacheOrigin,
  ResponseCacheRequest,
  ResponseCacheResult,
  ResponseCacheStats,
  ResponseSnapshot,
} from "./types.js";

interface FetchAndStoreResult {
  snapshot: ResponseSnapshot;
  stored: boolean;
  notStoredReason?: string;
  cacheWriteError?: boolean;
  leaseWaitHit?: boolean;
}

export function createResponseCache(
  options: ResponseCacheOptions = {}
): ResponseCache {
  return new DefaultResponseCache(options);
}

class DefaultResponseCache implements ResponseCache {
  private readonly options: ResolvedResponseCacheOptions;
  private readonly singleFlight = new SingleFlight();

  constructor(options: ResponseCacheOptions) {
    this.options = resolveOptions(options);
  }

  async handle(
    request: ResponseCacheRequest,
    origin: ResponseCacheOrigin,
    options: ResponseCacheHandleOptions = {}
  ): Promise<ResponseCacheResult> {
    const resolved = mergeHandleOptions(this.options, options);
    const requestDecision = evaluateRequestPolicy(request, resolved);

    if (!requestDecision.cacheable) {
      const response = await origin();
      return originToResult(response, {
        state: "bypass",
        reason: requestDecision.reason as string,
      });
    }

    const key = createResponseCacheKey(request, resolved);
    const cached = await this.getCachedSnapshot(key, resolved);
    if (cached) {
      return restoreSnapshot(
        cached,
        { state: "hit", key, stored: true },
        resolved.now()
      );
    }

    const flight = await this.singleFlight.do(key, () =>
      this.fetchAndStoreWithLease(key, origin, resolved)
    );

    const metadata = createMissMetadata(
      key,
      flight.shared || flight.value.leaseWaitHit === true,
      flight.value.stored,
      flight.value.notStoredReason,
      flight.value.cacheWriteError
    );

    return restoreSnapshot(flight.value.snapshot, metadata, resolved.now());
  }

  makeKey(
    request: ResponseCacheRequest,
    options: ResponseCacheHandleOptions = {}
  ): string {
    const resolved = mergeHandleOptions(this.options, options);
    return createResponseCacheKey(request, resolved);
  }

  async clear(): Promise<void> {
    await clearResponseCacheRuntime(
      this.options.runtime,
      this.options.namespaceTag
    );
  }

  async delete(key: string): Promise<void> {
    await this.options.cache.del(key);
  }

  async invalidateTag(tag: string): Promise<void> {
    await invalidateResponseCacheTag(this.options.runtime, tag);
  }

  stats(): ResponseCacheStats {
    return (
      this.options.cache.getStats?.() ?? {
        hits: 0,
        misses: 0,
        hitRate: 0,
        entries: 0,
        evictions: 0,
        sets: 0,
        deletes: 0,
        memoryUsage: 0,
        memoryUsageMB: 0,
      }
    );
  }

  async getRemainingTtl(key: string): Promise<number | null | undefined> {
    return this.options.cache.getRemainingTtl?.(key);
  }

  getStore() {
    return this.options.cache;
  }

  async close(): Promise<void> {
    await this.options.runtime.close();
  }

  private async getCachedSnapshot(
    key: string,
    options: ResolvedResponseCacheOptions
  ): Promise<ResponseSnapshot | undefined> {
    try {
      return await options.cache.get<ResponseSnapshot>(key);
    } catch {
      return undefined;
    }
  }

  private async fetchAndStore(
    key: string,
    origin: ResponseCacheOrigin,
    options: ResolvedResponseCacheOptions
  ): Promise<FetchAndStoreResult> {
    const response = await origin();
    const headers = normalizeHeaders(response.headers);
    const snapshot = createResponseSnapshot(response, {
      now: options.now(),
      ttl: options.ttl,
    });
    const responseDecision = evaluateResponsePolicy(response, headers, options);

    if (!responseDecision.cacheable) {
      return {
        snapshot,
        stored: false,
        notStoredReason: responseDecision.reason as string,
      };
    }

    try {
      await setResponseSnapshot(
        options.cache,
        key,
        snapshot,
        options.ttl,
        options.tags,
        options.namespaceTag
      );
      return { snapshot, stored: true };
    } catch {
      return {
        snapshot,
        stored: false,
        cacheWriteError: true,
        notStoredReason: "cache-write-failed",
      };
    }
  }

  private async fetchAndStoreWithLease(
    key: string,
    origin: ResponseCacheOrigin,
    options: ResolvedResponseCacheOptions
  ): Promise<FetchAndStoreResult> {
    const leaseStore = options.runtime.leaseStore;
    const leaseOptions = options.runtime.lease;
    if (!leaseStore || !leaseOptions) {
      return this.fetchAndStore(key, origin, options);
    }

    const leaseTtl = resolveLeaseTtl(options.ttl, leaseOptions.ttl);
    const lease = await leaseStore.acquireLease(key, leaseTtl);
    if (lease) {
      try {
        return await this.fetchAndStore(key, origin, options);
      } finally {
        await lease.release().catch(() => false);
      }
    }

    const waitedSnapshot = await this.waitForLeaseFill(
      key,
      options,
      leaseOptions.waitForOwner ?? leaseTtl + 25,
      leaseOptions.pollInterval ?? 10
    );
    if (waitedSnapshot) {
      return {
        snapshot: waitedSnapshot,
        stored: true,
        leaseWaitHit: true,
      };
    }

    const retryLease = await leaseStore.acquireLease(key, leaseTtl);
    if (retryLease) {
      try {
        return await this.fetchAndStore(key, origin, options);
      } finally {
        await retryLease.release().catch(() => false);
      }
    }

    if (leaseOptions.onTimeout === "throw") {
      throw new Error(`[response-cache-kit] lease wait timed out for key: ${key}`);
    }

    return this.fetchAndStore(key, origin, options);
  }

  private async waitForLeaseFill(
    key: string,
    options: ResolvedResponseCacheOptions,
    waitMs: number,
    pollIntervalMs: number
  ): Promise<ResponseSnapshot | undefined> {
    const deadline = Date.now() + Math.max(0, Math.floor(waitMs));
    const pollMs = Math.max(1, Math.floor(pollIntervalMs));

    while (Date.now() <= deadline) {
      const cached = await this.getCachedSnapshot(key, options);
      if (cached) {
        return cached;
      }
      await sleep(pollMs);
    }

    return undefined;
  }
}

function resolveOptions(options: ResponseCacheOptions): ResolvedResponseCacheOptions {
  const ttl = options.ttl ?? 60_000;
  const namespace = options.namespace ?? "response-cache";
  const runtime = createResponseCacheRuntime(options.cacheHub, ttl);
  const resolved: ResolvedResponseCacheOptions = {
    runtime,
    cache: runtime.cache,
    ttl,
    namespace,
    namespaceTag: createResponseCacheNamespaceTag(namespace),
    vary: options.vary ?? [],
    tags: options.tags ?? [],
    cacheableMethods: new Set(
      (options.cacheableMethods ?? DEFAULT_CACHEABLE_METHODS).map((method) =>
        method.toUpperCase()
      )
    ),
    cacheableStatuses: new Set(
      options.cacheableStatuses ?? DEFAULT_CACHEABLE_STATUSES
    ),
    allowAuthorizationCache: options.allowAuthorizationCache === true,
    now: options.now ?? Date.now,
  };

  if (options.keyBuilder) {
    resolved.keyBuilder = options.keyBuilder;
  }

  return resolved;
}

function mergeHandleOptions(
  base: ResolvedResponseCacheOptions,
  overrides: ResponseCacheHandleOptions
): ResolvedResponseCacheOptions {
  const merged: ResolvedResponseCacheOptions = {
    runtime: base.runtime,
    cache: base.cache,
    ttl: overrides.ttl ?? base.ttl,
    namespace: overrides.namespace ?? base.namespace,
    namespaceTag: overrides.namespace
      ? createResponseCacheNamespaceTag(overrides.namespace)
      : base.namespaceTag,
    vary: overrides.vary ?? base.vary,
    tags: mergeTags(base.tags, overrides.tags),
    cacheableMethods: overrides.cacheableMethods
      ? new Set(overrides.cacheableMethods.map((method) => method.toUpperCase()))
      : base.cacheableMethods,
    cacheableStatuses: overrides.cacheableStatuses
      ? new Set(overrides.cacheableStatuses)
      : base.cacheableStatuses,
    allowAuthorizationCache:
      overrides.allowAuthorizationCache ?? base.allowAuthorizationCache,
    now: overrides.now ?? base.now,
  };

  const keyBuilder = overrides.keyBuilder ?? base.keyBuilder;
  if (keyBuilder) {
    merged.keyBuilder = keyBuilder;
  }

  return merged;
}

function mergeTags(
  base: readonly string[],
  overrides?: readonly string[]
): readonly string[] {
  if (!overrides) {
    return base;
  }
  return Array.from(new Set([...base, ...overrides]));
}

function createMissMetadata(
  key: string,
  shared: boolean,
  stored: boolean,
  reason?: string,
  cacheWriteError?: boolean
): ResponseCacheMetadata {
  const metadata: ResponseCacheMetadata = {
    state: shared ? "deduped" : "miss",
    key,
    stored,
    deduped: shared,
  };

  if (reason) {
    metadata.reason = reason;
  }
  if (cacheWriteError) {
    metadata.cacheWriteError = true;
  }

  return metadata;
}

function resolveLeaseTtl(ttl: number, override?: number): number {
  if (override !== undefined) {
    return Math.max(1, Math.floor(override));
  }
  return Math.max(50, Math.min(Math.max(1, ttl), 5_000));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
