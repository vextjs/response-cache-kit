import type { CacheLike, CacheStats, MemoryCacheOptions } from "cache-hub";

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
    varyAllHeaders: boolean;
  }
) => string;

export type ResponseCacheVary = readonly string[] | "*";

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
  vary?: ResponseCacheVary;
  tags?: readonly string[];
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
  delete(key: string): Promise<void>;
  invalidateTag(tag: string): Promise<void>;
  stats(): ResponseCacheStats;
  getRemainingTtl(key: string): Promise<number | null | undefined>;
  clear(): Promise<void>;
  getStore(): CacheLike;
}

export interface ResponseCacheStats extends CacheStats {}

export interface ResolvedResponseCacheOptions {
  cache: CacheLike;
  ttl: number;
  namespace: string;
  vary: ResponseCacheVary;
  tags: readonly string[];
  cacheableMethods: ReadonlySet<string>;
  cacheableStatuses: ReadonlySet<number>;
  allowAuthorizationCache: boolean;
  now: () => number;
  keyBuilder?: ResponseCacheKeyBuilder;
}

export interface ResponseCacheHeaderOptions {
  cacheHeaderName?: string | false;
  cacheControl?: boolean;
  cacheControlHeaderName?: string;
  cacheControlScope?: "public" | "private";
}

export interface ResponseCacheAdapterRequestInput {
  method?: string;
  url?: string | URL;
  headers?: HeadersLike;
  partitionKey?: string | null;
}

export interface ResponseCacheWritePayload {
  status: number;
  headers: HeaderBag;
  body: unknown;
}

export interface ResponseCacheCapture {
  setStatus(status: number): void;
  setHeader(name: string, value: HeaderValue): void;
  setBody(body: unknown): void;
  toOriginResponse(): ResponseCacheOriginResponse;
}
