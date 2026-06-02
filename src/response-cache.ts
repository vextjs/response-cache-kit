import { createMemoryResponseCacheStore } from "./store.js";
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
  ResponseCacheOriginResponse,
  ResponseCacheRequest,
  ResponseCacheResult,
  ResponseSnapshot,
} from "./types.js";

interface FetchAndStoreResult {
  response: ResponseCacheOriginResponse;
  snapshot: ResponseSnapshot;
  stored: boolean;
  notStoredReason?: string;
  cacheWriteError?: boolean;
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
      this.fetchAndStore(key, origin, resolved)
    );

    const metadata = createMissMetadata(
      key,
      flight.shared,
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
    await this.options.cache.clear();
  }

  getStore() {
    return this.options.cache;
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
        response,
        snapshot,
        stored: false,
        notStoredReason: responseDecision.reason as string,
      };
    }

    try {
      await options.cache.set(key, snapshot, options.ttl);
      return { response, snapshot, stored: true };
    } catch {
      return {
        response,
        snapshot,
        stored: false,
        cacheWriteError: true,
        notStoredReason: "cache-write-failed",
      };
    }
  }
}

function resolveOptions(options: ResponseCacheOptions): ResolvedResponseCacheOptions {
  const ttl = options.ttl ?? 60_000;
  const namespace = options.namespace ?? "response-cache";
  const cache = createMemoryResponseCacheStore({
    defaultTtl: ttl,
    ...(options.cacheHub ?? {}),
  });
  const resolved: ResolvedResponseCacheOptions = {
    cache,
    ttl,
    namespace,
    vary: options.vary ?? [],
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
    cache: base.cache,
    ttl: overrides.ttl ?? base.ttl,
    namespace: overrides.namespace ?? base.namespace,
    vary: overrides.vary ?? base.vary,
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
