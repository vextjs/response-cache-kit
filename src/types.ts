import type { CacheLike, MemoryCacheOptions } from "cache-hub";

export type HeaderValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly string[];

export type HeaderBag = Record<string, string>;

export type HeadersLike =
  | Record<string, HeaderValue>
  | Iterable<readonly [string, HeaderValue]>
  | {
      forEach(callback: (value: string, key: string) => void): void;
    };

export interface ResponseCacheRequest {
  method?: string;
  url: string;
  headers?: HeadersLike;
  partitionKey?: string;
}

export interface ResponseCacheOriginResponse {
  status?: number;
  headers?: HeadersLike;
  body: unknown;
}

export type ResponseCacheOrigin = () =>
  | ResponseCacheOriginResponse
  | Promise<ResponseCacheOriginResponse>;

export type ResponseCacheState =
  | "hit"
  | "miss"
  | "deduped"
  | "bypass"
  | "error";

export interface ResponseCacheMetadata {
  state: ResponseCacheState;
  key?: string;
  reason?: string;
  ttl?: number;
  age?: number;
  stored?: boolean;
  deduped?: boolean;
  cacheWriteError?: boolean;
}

export interface ResponseCacheResult {
  status: number;
  headers: HeaderBag;
  body: unknown;
  metadata: ResponseCacheMetadata;
}

export interface ResponseSnapshot {
  status: number;
  headers: HeaderBag;
  body: unknown;
  createdAt: number;
  ttl: number;
}

export type ResponseCacheKeyBuilder = (
  request: ResponseCacheRequest,
  context: {
    namespace: string;
    vary: readonly string[];
  }
) => string;

export interface ResponseCacheHubOptions {
  maxEntries?: NonNullable<MemoryCacheOptions["maxEntries"]>;
  maxMemory?: NonNullable<MemoryCacheOptions["maxMemory"]>;
  enableStats?: NonNullable<MemoryCacheOptions["enableStats"]>;
  cleanupInterval?: NonNullable<MemoryCacheOptions["cleanupInterval"]>;
  enabled?: NonNullable<MemoryCacheOptions["enabled"]>;
}

export interface ResponseCacheOptions {
  cacheHub?: ResponseCacheHubOptions;
  ttl?: number;
  namespace?: string;
  vary?: readonly string[];
  cacheableMethods?: readonly string[];
  cacheableStatuses?: readonly number[];
  allowAuthorizationCache?: boolean;
  now?: () => number;
  keyBuilder?: ResponseCacheKeyBuilder;
}

export type ResponseCacheHandleOptions = Omit<
  ResponseCacheOptions,
  "cacheHub"
>;

export interface ResponseCache {
  handle(
    request: ResponseCacheRequest,
    origin: ResponseCacheOrigin,
    options?: ResponseCacheHandleOptions
  ): Promise<ResponseCacheResult>;
  makeKey(
    request: ResponseCacheRequest,
    options?: ResponseCacheHandleOptions
  ): string;
  clear(): Promise<void>;
  getStore(): CacheLike;
}

export interface ResolvedResponseCacheOptions {
  cache: CacheLike;
  ttl: number;
  namespace: string;
  vary: readonly string[];
  cacheableMethods: ReadonlySet<string>;
  cacheableStatuses: ReadonlySet<number>;
  allowAuthorizationCache: boolean;
  now: () => number;
  keyBuilder?: ResponseCacheKeyBuilder;
}
