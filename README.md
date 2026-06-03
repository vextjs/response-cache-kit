# response-cache-kit

vext-first response caching toolkit for Node.js services.

`response-cache-kit` is part of the vext ecosystem. Its first acceptance target
is replacing vext response caching, while keeping the core independent from any
specific web framework. Express, Fastify, Hono, native HTTP, and future vext
adapters should reuse the same helpers instead of copying cache plumbing.

Chinese documentation: [docs/README.zh-CN.md](./docs/README.zh-CN.md)

## Table of Contents

- [Install](#install)
- [Quick Start](#quick-start)
- [Complete Configuration Example](#complete-configuration-example)
- [Configuration](#configuration)
- [Per-Route Overrides](#per-route-overrides)
- [Tags And Invalidation](#tags-and-invalidation)
- [API Reference](#api-reference)
- [Framework Integration Examples](#framework-integration-examples)
- [Defaults](#defaults)
- [Concurrent Expiry Protection](#concurrent-expiry-protection)
- [vext Migration Notes](#vext-migration-notes)
- [Future Batches](#future-batches)
- [Scripts](#scripts)
- [Troubleshooting](#troubleshooting)
- [License](#license)

## Install

```bash
npm install response-cache-kit
```

## Quick Start

```typescript
import {
  createResponseCache,
  createResponseCacheWritePayload,
} from "response-cache-kit";

const cache = createResponseCache({ ttl: 2_000 });

const result = await cache.handle(
  {
    method: "GET",
    url: "/products/42",
    headers: { "accept-language": "en-US" },
  },
  async () => {
    return {
      status: 200,
      headers: { "content-type": "application/json" },
      body: { id: 42, name: "Keyboard" },
    };
  }
);

console.log(result.metadata.state); // miss, hit, deduped, bypass, or error
console.log(
  createResponseCacheWritePayload(result, { cacheControl: true }).headers
); // includes X-Cache and Cache-Control
```

The package caches response snapshots: status, headers, body, TTL, and cache
metadata. A router or framework adapter decides where to call it.

Public responses do not need `partitionKey`. Responses that depend on a user,
tenant, session, or permission scope should pass `partitionKey` when calling
`cache.handle()`.

## Complete Configuration Example

This example shows the common production shape: a global cache instance, header
variants for language and tenant region, per-request user or tenant isolation,
and cache metadata written back to the response.

```typescript
import {
  createResponseCache,
  createResponseCacheWritePayload,
  normalizeResponseCacheRequest,
} from "response-cache-kit";

const responseCache = createResponseCache({
  ttl: 30_000,
  namespace: "products-api",
  vary: ["accept-language", "x-tenant-region"],
  cacheHub: {
    maxEntries: 5000,
    cleanupInterval: 30_000,
    enableStats: true,
  },
});

async function handleProductRequest(req, res) {
  const tenantId = req.user?.tenantId;
  const userId = req.user?.id;
  const partitionKey =
    tenantId && userId ? `tenant:${tenantId}:user:${userId}` : undefined;

  const result = await responseCache.handle(
    normalizeResponseCacheRequest({
      method: req.method,
      url: req.originalUrl ?? req.url,
      headers: req.headers,
      ...(partitionKey ? { partitionKey } : {}),
    }),
    async () => ({
      status: 200,
      headers: { "content-type": "application/json" },
      body: await loadProduct(req.params.id),
    }),
    { tags: ["products"] }
  );
  const payload = createResponseCacheWritePayload(result, {
    cacheControl: true,
  });

  for (const [name, value] of Object.entries(payload.headers)) {
    res.setHeader(name, value);
  }
  res.status(payload.status).send(payload.body);
}
```

Use `partitionKey` only for identity-dependent responses. Do not use raw access
tokens as partition keys; use stable business identifiers such as user, tenant,
organization, or session IDs.

## Configuration

### `createResponseCache(options)`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `cacheHub` | `ResponseCacheHubOptions` | `{}` | Options passed to the internal `cache-hub` `MemoryCache`. `defaultTtl` is not exposed because response TTL is controlled by `ttl`. |
| `ttl` | `number` | `60000` | Cache TTL in milliseconds. `ttl <= 0` bypasses caching. |
| `namespace` | `string` | `"response-cache"` | Prefix used when building cache keys. Useful when sharing one store across modules. |
| `vary` | `readonly string[] \| "*"` | `[]` | Header names that separate cache entries when those headers change the response. Use `"*"` only when every request header intentionally participates in the key. |
| `tags` | `readonly string[]` | `[]` | Tags written with stored responses. Use `cache.invalidateTag(tag)` after business data changes. |
| `cacheableMethods` | `readonly string[]` | `["GET", "HEAD"]` | Methods eligible for caching. Values are normalized to uppercase. |
| `cacheableStatuses` | `readonly number[]` | `[200, 203, 204, 206, 300, 301, 404, 410]` | Response statuses eligible for storage. |
| `allowAuthorizationCache` | `boolean` | `false` | Allows caching requests with `Authorization`. Prefer `partitionKey` for user/tenant separation. |
| `now` | `() => number` | `Date.now` | Clock function, mainly for tests and deterministic benchmarks. |
| `keyBuilder` | `ResponseCacheKeyBuilder` | built-in SHA-256 key builder | Advanced cache key builder. Receives the request plus `namespace`, resolved `vary`, and `varyAllHeaders`. |

`cacheHub` is intentionally a configuration object, not a way to pass your own
store instance. `response-cache-kit` creates the underlying `cache-hub` store
internally.

```typescript
import { createResponseCache } from "response-cache-kit";

const cache = createResponseCache({
  ttl: 10_000,
  namespace: "api",
  vary: ["accept-language", "accept-encoding"],
  cacheHub: {
    maxEntries: 5000,
    maxMemory: 64 * 1024 * 1024,
    cleanupInterval: 30_000,
    enableStats: true,
  },
});
```

`cacheHub` fields:

| Field | Type | Default from `cache-hub` | Description |
|-------|------|--------------------------|-------------|
| `maxEntries` | `number` | `10000` | Maximum number of entries kept by the internal memory store. |
| `maxMemory` | `number` | `0` | Approximate memory limit in bytes. `0` means unlimited. |
| `enableStats` | `boolean` | `true` | Enables `cache-hub` store statistics. |
| `cleanupInterval` | `number` | `0` | Periodic cleanup interval in milliseconds. `0` means lazy cleanup only. |
| `enabled` | `boolean` | `true` | Temporarily disables reads and writes in the internal store when set to `false`. |

`defaultTtl` and `enableTags` are not exposed in `cacheHub`. Response TTL belongs
to `response-cache-kit`; tag indexes are enabled internally so response tags and
`invalidateTag()` work without user store wiring.

### Cache Lifetime: `ttl`

`ttl` controls how long a stored response stays fresh. Use shorter values for
fast-changing data and longer values for slow-changing catalog or reference
data. `ttl <= 0` bypasses storage, which is useful for temporarily disabling
response caching without changing the call site.

### Key Namespace: `namespace`

`namespace` is the prefix used in generated cache keys. Change it when multiple
services, modules, or environments share the same underlying cache process.
Examples: `"products-api"`, `"admin-api"`, or `"staging-products-api"`.

### Header Variants: `vary`

`vary` accepts request header names. Header names are matched
case-insensitively. Only add headers that truly change the response body or
headers.

Good candidates:

- `accept-language` when localized responses differ by language.
- `accept-encoding` when the origin returns different encoded bodies.
- `x-tenant-region` or another low-cardinality business header that changes the
  response.
- A client version header when different app versions receive different payloads.

Avoid:

- `authorization` and `cookie`; use `partitionKey` for identity isolation.
- Trace IDs, request IDs, timestamps, nonce headers, or any value that changes
  on every request.
- Very high-cardinality headers that would create a separate cache entry for
  nearly every request.

If a response changes by language and `vary` does not include
`accept-language`, different languages may share the same cached response.

Use `vary: "*"` only when all request headers are part of your response
contract. It is convenient for strict internal adapters, but dangerous for public
traffic because request IDs, trace IDs, dates, cookies, or authorization-like
headers can produce a near-zero hit rate or leak sensitive key material through a
custom key builder. Prefer an explicit allowlist for normal applications.

### User and Tenant Isolation: `partitionKey`

`partitionKey` is not an HTTP header and is not read automatically. It is a
string you pass in `cache.handle()` to separate cached responses by user, tenant,
organization, session, or permission scope.

Common shapes:

```typescript
// Public response: no partitionKey.
{ method: "GET", url: "/products", headers: req.headers }

// User-specific response.
{ method: "GET", url: "/me", headers: req.headers, partitionKey: `user:${userId}` }

// Tenant-specific response.
{ method: "GET", url: "/settings", headers: req.headers, partitionKey: `tenant:${tenantId}` }

// Multi-tenant user-specific response.
{
  method: "GET",
  url: "/dashboard",
  headers: req.headers,
  partitionKey: `tenant:${tenantId}:user:${userId}`,
}
```

Requests with `Authorization` are bypassed by default unless you provide
`partitionKey` or explicitly enable `allowAuthorizationCache`. Prefer
`partitionKey`; it keeps authenticated responses isolated without putting raw
tokens into cache keys.

### Authenticated Requests: `allowAuthorizationCache`

The default `false` is a safety default. It prevents a response for one
authenticated caller from being reused by another caller by accident.

Set `allowAuthorizationCache: true` only when you are certain the response is
safe to share for the key you build. For most user or tenant responses, pass a
`partitionKey` instead.

### Cacheable Methods and Statuses

`cacheableMethods` defaults to `["GET", "HEAD"]`. Only add methods such as
`POST` when the endpoint is idempotent or the business flow explicitly treats
the response as cacheable.

`cacheableStatuses` defaults to common cacheable success, redirect, and negative
lookup statuses. Caching `404` or `410` can reduce repeated misses for missing
resources. Avoid caching server errors unless the behavior is intentionally
designed.

### Internal cache-hub Store: `cacheHub`

`cacheHub` configures the internal `cache-hub` memory store. It does not accept
an external store instance.

- `maxEntries`: cap the number of cached responses.
- `maxMemory`: approximate memory limit in bytes; `0` means no explicit limit.
- `enableStats`: keep cache-hub store statistics available for diagnostics.
- `cleanupInterval`: periodically remove expired entries; `0` means lazy cleanup.
- `enabled`: when `true`, the store reads and writes normally. When `false`, the
  underlying store is disabled, so requests still run through `cache.handle()`
  but cannot build useful hits. Use it for local debugging or temporary cache
  shutdowns, not as a long-term production setting.

### Advanced Key Builder: `keyBuilder`

`keyBuilder` is an escape hatch for teams that already have a shared cache key
format. If you provide it, make sure your key includes every piece of data that
can change the response: URL, normalized query, selected `vary` headers, and
`partitionKey`.

## Tags And Invalidation

Tags are a framework-neutral way to invalidate many response entries after a
business change. Tags can be configured globally and per call; per-call tags are
added to global tags.

```typescript
const cache = createResponseCache({
  ttl: 60_000,
  tags: ["catalog"],
});

await cache.handle(
  { method: "GET", url: "/products/42" },
  loadProductResponse,
  { tags: ["product:42"] }
);

await cache.invalidateTag("product:42");
```

Use readable keys when you want targeted deletion:

```typescript
const key = cache.makeKey({ method: "GET", url: "/products/42" });
await cache.delete(key);
```

`cache.stats()` exposes the internal `cache-hub` counters, and
`cache.getRemainingTtl(key)` returns the remaining TTL in milliseconds,
`null` for a non-expiring key, or `undefined` when the key is missing or the
store cannot report TTL.

## Per-Route Overrides

Global options apply to most routes. Per-route overrides are for endpoints that
need different behavior, such as a shorter TTL or a cacheable `POST` response.
`cacheHub` cannot be overridden per route because it configures the lifecycle of
the internal store and must be chosen when the cache instance is created.

```typescript
await cache.handle(
  { method: "POST", url: "/reports" },
  createReport,
  {
    ttl: 5_000,
    cacheableMethods: ["POST"],
    cacheableStatuses: [202],
  }
);
```

## API Reference

### `cache.handle(request, origin, options?)`

Runs the response cache flow and returns a normalized response result.

`request` fields:

| Field | Type | Required | Description |
|-------|------|:--------:|-------------|
| `url` | `string` | Yes | URL or path used in the cache key. Query parameters are normalized. |
| `method` | `string` | No | Defaults to `GET`. |
| `headers` | `HeadersLike` | No | Plain object, iterable entries, or Web `Headers`-like object. |
| `partitionKey` | `string` | No | Adds user/tenant/session separation for authenticated responses. |

`origin` returns:

| Field | Type | Required | Description |
|-------|------|:--------:|-------------|
| `body` | `unknown` | Yes | Response body to return and optionally cache. |
| `status` | `number` | No | Defaults to `200`. |
| `headers` | `HeadersLike` | No | Response headers. Hop-by-hop headers are filtered before storage. |

`handle()` returns:

| Field | Type | Description |
|-------|------|-------------|
| `status` | `number` | Normalized response status. |
| `headers` | `Record<string, string>` | Normalized response headers. |
| `body` | `unknown` | Response body. |
| `metadata` | `ResponseCacheMetadata` | Cache state, key, reason, age, TTL, storage and dedupe flags. |

Metadata states:

| State | Meaning |
|-------|---------|
| `miss` | No usable cached snapshot; origin ran. |
| `hit` | Cached snapshot returned. |
| `deduped` | Another same-key request refreshed the origin; this request waited for it. |
| `bypass` | Request policy skipped caching. |
| `error` | Reserved for adapter-level error mapping. Core origin errors are rethrown. |

### `cache.makeKey(request, options?)`

Builds the cache key without reading or writing the store.

### `cache.clear()`

Clears the underlying `cache-hub` store.

### `cache.delete(key)`

Deletes one response cache entry by key. The default key is hashed; if your
framework needs human-readable deletion keys, provide a `keyBuilder` or use a
preset such as `createVextResponseCacheOptions()`.

### `cache.invalidateTag(tag)`

Invalidates all entries written with the given tag.

### `cache.stats()`

Returns `cache-hub` statistics such as `entries`, `hits`, `misses`, `hitRate`,
`sets`, `deletes`, and memory counters.

### `cache.getRemainingTtl(key)`

Returns the remaining TTL in milliseconds, `null` for a non-expiring key, or
`undefined` when the key is missing or TTL lookup is unavailable.

### `createResponseCacheHeaders(result, options?)`

Creates response cache headers from metadata. By default it emits `X-Cache:
HIT` for hits and `X-Cache: MISS` for miss-like states. Set
`cacheControl: true` to also emit `Cache-Control: public,max-age=N`.

### Adapter helpers

Use these helpers in framework adapters:

| Helper | Purpose |
|--------|---------|
| `normalizeResponseCacheRequest(input)` | Converts framework request fields into `ResponseCacheRequest`. |
| `createResponseCacheWritePayload(result, options?)` | Merges cached response headers with `X-Cache` / `Cache-Control` helper output. |
| `createResponseCacheCapture(initial?)` | Captures status, headers, and body for adapters that intercept framework sends. |

### vext preset helpers

`createVextResponseCacheOptions(routeCacheConfig, base?)` converts vext-style
`cache: false | number | { ttl, vary, tags, key, condition }` configuration to
`ResponseCacheHandleOptions`. Number and object `ttl` values are milliseconds.
`condition` remains an adapter-side decision: when it
returns `false`, skip `cache.handle()` and call the route handler directly.
`createVextLegacyKey()` produces readable keys such as `GET:/products/42` so a
vext adapter can keep `app.cache.delete(key)` ergonomic.

### `cache.getStore()`

Returns the underlying `cache-hub` store for diagnostics or explicit lifecycle
operations.

## Framework Integration Examples

The core API is framework-agnostic. Framework integrations should adapt the
incoming request to `ResponseCacheRequest`, call `cache.handle()`, then write the
returned status, headers, body, and metadata back to the framework response.

### Native Node HTTP

```typescript
import { createServer } from "node:http";
import {
  createResponseCache,
  createResponseCacheWritePayload,
  normalizeResponseCacheRequest,
} from "response-cache-kit";

const cache = createResponseCache({ ttl: 2_000 });

createServer(async (req, res) => {
  const result = await cache.handle(
    normalizeResponseCacheRequest({
      method: req.method,
      url: req.url ?? "/",
      headers: req.headers,
    }),
    async () => ({
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok: true }),
    })
  );
  const payload = createResponseCacheWritePayload(result, {
    cacheControl: true,
  });

  res.statusCode = payload.status;
  for (const [name, value] of Object.entries(payload.headers)) {
    res.setHeader(name, value);
  }
  res.end(String(payload.body));
}).listen(3000);
```

### Express-Style Middleware

```typescript
import {
  createResponseCache,
  createResponseCacheWritePayload,
  normalizeResponseCacheRequest,
} from "response-cache-kit";

const cache = createResponseCache({ ttl: 2_000 });

export function responseCacheMiddleware(fetchOrigin) {
  return async (req, res, next) => {
    try {
      const partitionKey = req.user?.id;
      const result = await cache.handle(
        normalizeResponseCacheRequest({
          method: req.method,
          url: req.originalUrl ?? req.url,
          headers: req.headers,
          ...(partitionKey ? { partitionKey } : {}),
        }),
        () => fetchOrigin(req)
      );
      const payload = createResponseCacheWritePayload(result, {
        cacheControl: true,
      });

      res.status(payload.status);
      for (const [name, value] of Object.entries(payload.headers)) {
        res.setHeader(name, value);
      }
      res.send(payload.body);
    } catch (error) {
      next(error);
    }
  };
}
```

### Fastify-Style Handler

```typescript
import {
  createResponseCache,
  createResponseCacheWritePayload,
  normalizeResponseCacheRequest,
} from "response-cache-kit";

const cache = createResponseCache({ ttl: 2_000 });

fastify.get("/products/:id", async (request, reply) => {
  const result = await cache.handle(
    normalizeResponseCacheRequest({
      method: request.method,
      url: request.url,
      headers: request.headers,
    }),
    async () => ({
      status: 200,
      headers: { "content-type": "application/json" },
      body: await loadProduct(request.params.id),
    })
  );
  const payload = createResponseCacheWritePayload(result, {
    cacheControl: true,
  });

  reply.code(payload.status);
  for (const [name, value] of Object.entries(payload.headers)) {
    reply.header(name, value);
  }
  return payload.body;
});
```

### Hono-Style Handler

```typescript
import {
  createResponseCache,
  createResponseCacheHeaders,
  normalizeResponseCacheRequest,
} from "response-cache-kit";

const cache = createResponseCache({ ttl: 2_000 });

app.get("/products/:id", async (c) => {
  const result = await cache.handle(
    normalizeResponseCacheRequest({
      method: c.req.method,
      url: c.req.url,
      headers: c.req.raw.headers,
    }),
    async () => ({
      status: 200,
      headers: { "content-type": "application/json" },
      body: await loadProduct(c.req.param("id")),
    })
  );

  for (const [name, value] of Object.entries(createResponseCacheHeaders(result))) {
    c.header(name, value);
  }
  return c.json(result.body, result.status);
});
```

### vext-style adapter preset

```typescript
import {
  createResponseCache,
  createResponseCacheWritePayload,
  createVextResponseCacheOptions,
  normalizeResponseCacheRequest,
} from "response-cache-kit";

const cache = createResponseCache({ namespace: "vext" });

async function runVextRoute(req, res, route) {
  const routeCache = createVextResponseCacheOptions(route.cache);
  if (routeCache === false || route.cache?.condition?.(req) === false) {
    return route.handler(req, res);
  }

  const result = await cache.handle(
    normalizeResponseCacheRequest({
      method: req.method,
      url: req.url,
      headers: req.headers,
      partitionKey: req.user?.id ? `user:${req.user.id}` : undefined,
    }),
    () => route.handler(req, res),
    routeCache
  );
  const payload = createResponseCacheWritePayload(result, {
    cacheControl: true,
  });

  for (const [name, value] of Object.entries(payload.headers)) {
    res.setHeader(name, value);
  }
  return res.status(payload.status).send(payload.body);
}
```

## Defaults

- Caches `GET` and `HEAD` by default.
- Uses millisecond TTL values.
- Skips `Set-Cookie`, `private`, and `no-store` responses by default.
- Skips `Authorization` requests unless a `partitionKey` is provided.
- Filters hop-by-hop headers from cached snapshots.
- Uses same-key single-flight protection for concurrent refreshes.
- Enables cache-hub tag indexes internally.

## Concurrent Expiry Protection

If a cached response has `ttl: 2_000` and 10000 identical requests arrive after
it expires, only one request refreshes the origin. The other requests wait for
the same in-flight refresh and return the same updated response snapshot.

Different keys are independent. Failed origin refreshes are not cached, and a
later request can retry.

## vext Migration Notes

vext can keep its public `cache: false | number | RouteCacheOptions` shape by
normalizing route options with `createVextResponseCacheOptions()`.

| vext behavior | response-cache-kit support |
|---------------|----------------------------|
| `cache: false` | `createVextResponseCacheOptions(false)` returns `false`. |
| `cache: number` | Number is treated as milliseconds. |
| `ttl` object option | Object `ttl` is treated as milliseconds. |
| `vary` | Passed to `vary`, including explicit `vary: "*"` when needed. |
| `tags` | Written to cache-hub tag indexes and invalidated through `invalidateTag()`. |
| readable deletion key | `createVextLegacyKey()` returns keys like `GET:/products`. |
| `X-Cache` / `Cache-Control` | `createResponseCacheWritePayload(result, { cacheControl: true })`. |
| 204 / non-2xx bypass | `VEXT_CACHEABLE_STATUSES` includes 2xx statuses except 204. |

## Future Batches

`stale-while-revalidate` is intentionally not part of this batch.

- `stale-while-revalidate`: return stale data during a stale window while one
  background refresh updates the cache.

It needs separate API and failure-semantics decisions before implementation.

## Scripts

```bash
npm run typecheck
npm test
npm run test:coverage
npm run build
npm run benchmark
npm run benchmark:http
npm run benchmark:compare
npm run pack:check
npm audit
npm pack --dry-run
```

`npm run benchmark` includes an `expired-race-10000-same-key` scenario. The
expected `originCalls` value is `1`.

## Troubleshooting

### Why is every request `bypass`?

Check the request method, request headers, response headers, and TTL:

- Methods other than `GET` and `HEAD` bypass unless included in
  `cacheableMethods`.
- `ttl <= 0` bypasses storage.
- Requests with `Authorization` bypass unless you pass `partitionKey` or enable
  `allowAuthorizationCache`.
- Responses with `Set-Cookie`, `Cache-Control: private`, or
  `Cache-Control: no-store` bypass by default.

### Why is every request `miss`?

The request may be producing a different cache key each time. Check `url`,
query parameters, `partitionKey`, and `vary` headers. Avoid putting request IDs,
trace IDs, timestamps, or raw tokens into key inputs.

### How do I cache authenticated responses safely?

Prefer `partitionKey`. For example, use `user:${userId}` for user-specific data
or `tenant:${tenantId}:user:${userId}` for multi-tenant user data. Do not use raw
access tokens as partition keys.

### How do I avoid mixing languages or regions?

Add the headers that change the response to `vary`:

```typescript
createResponseCache({
  ttl: 30_000,
  vary: ["accept-language", "x-tenant-region"],
});
```

### What happens when `cacheHub.enabled` is `false`?

The internal cache-hub store stops reading and writing values, so stored cache
hits are disabled. Calls still go through `cache.handle()`, and same-key
in-flight requests can still be deduplicated during one concurrent wave, but no
stored value is reused after that wave finishes. Use this for local debugging or
temporary cache shutdowns, not as a long-term production setting.

### Can I use Redis or multi-level cache?

`cache-hub` is the only runtime caching dependency. Redis and multi-level cache
support should be designed as a separate cache-hub integration batch, not as an
external store option in `response-cache-kit`.

### Why is `npm run benchmark` heavier than unit tests?

It includes a 10000-request same-key expired-race scenario to verify concurrent
expiry protection. The expected `originCalls` value is `1`.

## License

Apache-2.0
