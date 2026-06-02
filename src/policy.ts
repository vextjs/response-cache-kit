import { getHeader, hasHeaderToken, normalizeHeaders } from "./headers.js";
import type {
  HeaderBag,
  ResolvedResponseCacheOptions,
  ResponseCacheOriginResponse,
  ResponseCacheRequest,
} from "./types.js";

export const DEFAULT_CACHEABLE_METHODS = ["GET", "HEAD"] as const;

export const DEFAULT_CACHEABLE_STATUSES = [
  200, 203, 204, 206, 300, 301, 404, 410,
] as const;

export interface CachePolicyDecision {
  cacheable: boolean;
  reason?: string;
}

export function evaluateRequestPolicy(
  request: ResponseCacheRequest,
  options: ResolvedResponseCacheOptions
): CachePolicyDecision {
  if (options.ttl <= 0) {
    return { cacheable: false, reason: "ttl-disabled" };
  }

  const method = normalizeMethod(request.method);
  if (!options.cacheableMethods.has(method)) {
    return { cacheable: false, reason: "method-not-cacheable" };
  }

  const headers = normalizeHeaders(request.headers);
  if (hasHeaderToken(headers, "cache-control", "no-store")) {
    return { cacheable: false, reason: "request-no-store" };
  }
  if (hasHeaderToken(headers, "cache-control", "no-cache")) {
    return { cacheable: false, reason: "request-no-cache" };
  }

  if (
    getHeader(headers, "authorization") &&
    !options.allowAuthorizationCache &&
    !request.partitionKey
  ) {
    return { cacheable: false, reason: "authorization-without-partition" };
  }

  return { cacheable: true };
}

export function evaluateResponsePolicy(
  response: ResponseCacheOriginResponse,
  headers: HeaderBag,
  options: ResolvedResponseCacheOptions
): CachePolicyDecision {
  const status = normalizeStatus(response.status);
  if (!options.cacheableStatuses.has(status)) {
    return { cacheable: false, reason: "status-not-cacheable" };
  }

  if (getHeader(headers, "set-cookie")) {
    return { cacheable: false, reason: "set-cookie" };
  }

  if (hasHeaderToken(headers, "cache-control", "no-store")) {
    return { cacheable: false, reason: "response-no-store" };
  }

  if (hasHeaderToken(headers, "cache-control", "private")) {
    return { cacheable: false, reason: "response-private" };
  }

  return { cacheable: true };
}

export function normalizeMethod(method?: string): string {
  return (method ?? "GET").toUpperCase();
}

export function normalizeStatus(status?: number): number {
  return typeof status === "number" ? status : 200;
}
