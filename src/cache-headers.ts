import type {
  HeaderBag,
  ResponseCacheHeaderOptions,
  ResponseCacheResult,
  ResponseCacheState,
} from "./types.js";

const DEFAULT_CACHE_HEADER = "X-Cache";
const DEFAULT_CACHE_CONTROL_HEADER = "Cache-Control";

/**
 * Builds framework-neutral cache headers from response-cache metadata.
 */
export function createResponseCacheHeaders(
  result: ResponseCacheResult,
  options: ResponseCacheHeaderOptions = {}
): HeaderBag {
  const headers: HeaderBag = {};
  const cacheHeaderName = options.cacheHeaderName ?? DEFAULT_CACHE_HEADER;

  if (cacheHeaderName !== false) {
    headers[cacheHeaderName] = toCacheHeaderValue(result.metadata.state);
  }

  if (options.cacheControl === true) {
    const maxAge = getMaxAgeSeconds(result);
    if (maxAge !== undefined) {
      const scope = options.cacheControlScope ?? "public";
      headers[options.cacheControlHeaderName ?? DEFAULT_CACHE_CONTROL_HEADER] =
        `${scope},max-age=${maxAge}`;
    }
  }

  return headers;
}

export function toCacheHeaderValue(state: ResponseCacheState): "HIT" | "MISS" {
  return state === "hit" ? "HIT" : "MISS";
}

export function getMaxAgeSeconds(
  result: ResponseCacheResult
): number | undefined {
  if (result.metadata.stored !== true) {
    return undefined;
  }

  const ttl = result.metadata.ttl;
  if (ttl === undefined) {
    return undefined;
  }

  const age = result.metadata.age ?? 0;
  return Math.max(0, Math.ceil((ttl - age) / 1000));
}
