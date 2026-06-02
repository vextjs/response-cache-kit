import { createHash } from "node:crypto";
import { stableStringify } from "cache-hub";
import { normalizeHeaders } from "./headers.js";
import { normalizeMethod } from "./policy.js";
import type {
  ResolvedResponseCacheOptions,
  ResponseCacheHandleOptions,
  ResponseCacheRequest,
} from "./types.js";

export function createResponseCacheKey(
  request: ResponseCacheRequest,
  options: ResolvedResponseCacheOptions | ResponseCacheHandleOptions
): string {
  const namespace = options.namespace ?? "response-cache";
  const vary = options.vary ?? [];

  if (options.keyBuilder) {
    return options.keyBuilder(request, { namespace, vary });
  }

  const headers = normalizeHeaders(request.headers);
  const varyHeaders: Record<string, string> = {};
  for (const rawName of vary) {
    const name = rawName.toLowerCase();
    const value = headers[name];
    if (value !== undefined) {
      varyHeaders[name] = value;
    }
  }

  const payload = {
    method: normalizeMethod(request.method),
    partitionKey: request.partitionKey ?? null,
    url: normalizeUrl(request.url),
    vary: varyHeaders,
  };

  const digest = createHash("sha256")
    .update(stableStringify(payload))
    .digest("base64url")
    .slice(0, 32);

  return `${namespace}:v1:${digest}`;
}

export function normalizeUrl(rawUrl: string): string {
  const hasScheme = /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(rawUrl);

  try {
    const url = new URL(
      rawUrl,
      hasScheme ? undefined : "http://response-cache-kit.local"
    );
    const pairs = Array.from(url.searchParams.entries()).sort(([ak, av], [bk, bv]) => {
      if (ak === bk) {
        return av.localeCompare(bv);
      }
      return ak.localeCompare(bk);
    });
    const search = new URLSearchParams(pairs).toString();
    const path = `${url.pathname}${search ? `?${search}` : ""}`;
    return hasScheme ? `${url.origin}${path}` : path;
  } catch {
    return rawUrl;
  }
}
