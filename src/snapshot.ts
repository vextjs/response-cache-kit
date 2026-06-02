import { normalizeHeaders } from "./headers.js";
import { normalizeStatus } from "./policy.js";
import type {
  HeaderBag,
  ResponseCacheMetadata,
  ResponseCacheOriginResponse,
  ResponseCacheResult,
  ResponseSnapshot,
} from "./types.js";

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

export function createResponseSnapshot(
  response: ResponseCacheOriginResponse,
  context: {
    now: number;
    ttl: number;
  }
): ResponseSnapshot {
  return {
    status: normalizeStatus(response.status),
    headers: filterCacheableHeaders(normalizeHeaders(response.headers)),
    body: response.body,
    createdAt: context.now,
    ttl: context.ttl,
  };
}

export function restoreSnapshot(
  snapshot: ResponseSnapshot,
  metadata: ResponseCacheMetadata,
  now: number
): ResponseCacheResult {
  return {
    status: snapshot.status,
    headers: { ...snapshot.headers },
    body: snapshot.body,
    metadata: {
      ...metadata,
      age: Math.max(0, now - snapshot.createdAt),
      ttl: snapshot.ttl,
    },
  };
}

export function originToResult(
  response: ResponseCacheOriginResponse,
  metadata: ResponseCacheMetadata
): ResponseCacheResult {
  return {
    status: normalizeStatus(response.status),
    headers: normalizeHeaders(response.headers),
    body: response.body,
    metadata,
  };
}

export function filterCacheableHeaders(headers: HeaderBag): HeaderBag {
  const filtered: HeaderBag = {};
  for (const [name, value] of Object.entries(headers)) {
    if (!HOP_BY_HOP_HEADERS.has(name)) {
      filtered[name] = value;
    }
  }
  return filtered;
}
