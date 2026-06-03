import { normalizeHeaders } from "../headers.js";
import { normalizeUrl } from "../key.js";
import { normalizeMethod } from "../policy.js";
import type {
  ResponseCacheHandleOptions,
  ResponseCacheKeyBuilder,
  ResponseCacheRequest,
} from "../types.js";

export const VEXT_CACHEABLE_STATUSES = Array.from(
  { length: 100 },
  (_value, index) => index + 200
).filter((status) => status !== 204);

export interface VextRouteCacheOptions {
  ttl?: number;
  vary?: readonly string[] | "*";
  tags?: readonly string[];
  key?: ResponseCacheKeyBuilder;
  condition?: (request: unknown) => boolean;
  cacheableStatuses?: readonly number[];
  allowAuthorizationCache?: boolean;
}

export type VextRouteCacheConfig = false | number | VextRouteCacheOptions;

export function secondsToMilliseconds(seconds: number): number {
  return seconds * 1000;
}

export function createVextResponseCacheOptions(
  config: VextRouteCacheConfig,
  base: ResponseCacheHandleOptions = {}
): ResponseCacheHandleOptions | false {
  if (config === false) {
    return false;
  }

  const routeOptions =
    typeof config === "number" ? { ttl: config } : config;

  const options: ResponseCacheHandleOptions = {
    ...base,
    cacheableStatuses:
      routeOptions.cacheableStatuses ??
      base.cacheableStatuses ??
      VEXT_CACHEABLE_STATUSES,
    keyBuilder: routeOptions.key ?? base.keyBuilder ?? createVextLegacyKey,
  };

  if (routeOptions.ttl !== undefined) {
    options.ttl = routeOptions.ttl;
  }
  if (routeOptions.vary !== undefined) {
    options.vary = routeOptions.vary;
  }
  if (routeOptions.tags !== undefined) {
    options.tags = routeOptions.tags;
  }
  if (routeOptions.allowAuthorizationCache !== undefined) {
    options.allowAuthorizationCache = routeOptions.allowAuthorizationCache;
  }

  return options;
}

export function createVextLegacyKey(
  request: ResponseCacheRequest,
  context: { vary: readonly string[] }
): string {
  const parts = [
    `${normalizeMethod(request.method)}:${normalizeUrl(request.url)}`,
  ];

  if (request.partitionKey) {
    parts.push(`partition=${request.partitionKey}`);
  }

  const headers = normalizeHeaders(request.headers);
  for (const name of context.vary) {
    const normalized = name.toLowerCase();
    const value = headers[normalized];
    if (value !== undefined) {
      parts.push(`${normalized}=${value}`);
    }
  }

  return parts.join("|");
}
