# response-cache-kit

Framework-agnostic response caching toolkit for Node.js services.

`response-cache-kit` is part of the vext ecosystem. It uses `cache-hub` as the
default and only runtime caching dependency, while keeping the response cache
core independent from any specific web framework.

Chinese documentation: [docs/README.zh-CN.md](./docs/README.zh-CN.md)

## 目录导航

- [Install](#install)
- [Quick Start](#quick-start)
- [Complete Configuration Example](#complete-configuration-example)
- [Configuration](#configuration)
- [Per-Route Overrides](#per-route-overrides)
- [API Reference](#api-reference)
- [Framework Integration Examples](#framework-integration-examples)
- [Defaults](#defaults)
- [Concurrent Expiry Protection](#concurrent-expiry-protection)
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
import { createResponseCache } from "response-cache-kit";

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
import { createResponseCache } from "response-cache-kit";

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
    {
      method: req.method,
      url: req.originalUrl ?? req.url,
      headers: req.headers,
      ...(partitionKey ? { partitionKey } : {}),
    },
    async () => ({
      status: 200,
      headers: { "content-type": "application/json" },
      body: await loadProduct(req.params.id),
    })
  );

  res.setHeader("x-response-cache", result.metadata.state);
  res.status(result.status).send(result.body);
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
| `vary` | `readonly string[]` | `[]` | Header names that separate cache entries when those headers change the response. |
| `cacheableMethods` | `readonly string[]` | `["GET", "HEAD"]` | Methods eligible for caching. Values are normalized to uppercase. |
| `cacheableStatuses` | `readonly number[]` | `[200, 203, 204, 206, 300, 301, 404, 410]` | Response statuses eligible for storage. |
| `allowAuthorizationCache` | `boolean` | `false` | Allows caching requests with `Authorization`. Prefer `partitionKey` for user/tenant separation. |
| `now` | `() => number` | `Date.now` | Clock function, mainly for tests and deterministic benchmarks. |
| `keyBuilder` | `ResponseCacheKeyBuilder` | built-in SHA-256 key builder | Advanced cache key builder. Receives the request plus `namespace` and `vary`. |

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
to `response-cache-kit`, and tag invalidation is reserved for a later batch.

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

`vary` accepts any request header name. Header names are matched
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
import { createResponseCache } from "response-cache-kit";

const cache = createResponseCache({ ttl: 2_000 });

createServer(async (req, res) => {
  const result = await cache.handle(
    {
      method: req.method,
      url: req.url ?? "/",
      headers: req.headers,
    },
    async () => ({
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok: true }),
    })
  );

  res.statusCode = result.status;
  for (const [name, value] of Object.entries(result.headers)) {
    res.setHeader(name, value);
  }
  res.setHeader("x-response-cache", result.metadata.state);
  res.end(String(result.body));
}).listen(3000);
```

### Express-Style Middleware

```typescript
import { createResponseCache } from "response-cache-kit";

const cache = createResponseCache({ ttl: 2_000 });

export function responseCacheMiddleware(fetchOrigin) {
  return async (req, res, next) => {
    try {
      const partitionKey = req.user?.id;
      const result = await cache.handle(
        {
          method: req.method,
          url: req.originalUrl ?? req.url,
          headers: req.headers,
          ...(partitionKey ? { partitionKey } : {}),
        },
        () => fetchOrigin(req)
      );

      res.status(result.status);
      for (const [name, value] of Object.entries(result.headers)) {
        res.setHeader(name, value);
      }
      res.setHeader("x-response-cache", result.metadata.state);
      res.send(result.body);
    } catch (error) {
      next(error);
    }
  };
}
```

### Fastify-Style Handler

```typescript
import { createResponseCache } from "response-cache-kit";

const cache = createResponseCache({ ttl: 2_000 });

fastify.get("/products/:id", async (request, reply) => {
  const result = await cache.handle(
    {
      method: request.method,
      url: request.url,
      headers: request.headers,
    },
    async () => ({
      status: 200,
      headers: { "content-type": "application/json" },
      body: await loadProduct(request.params.id),
    })
  );

  reply.code(result.status);
  for (const [name, value] of Object.entries(result.headers)) {
    reply.header(name, value);
  }
  reply.header("x-response-cache", result.metadata.state);
  return result.body;
});
```

### Hono-Style Handler

```typescript
import { createResponseCache } from "response-cache-kit";

const cache = createResponseCache({ ttl: 2_000 });

app.get("/products/:id", async (c) => {
  const result = await cache.handle(
    {
      method: c.req.method,
      url: c.req.url,
      headers: c.req.raw.headers,
    },
    async () => ({
      status: 200,
      headers: { "content-type": "application/json" },
      body: await loadProduct(c.req.param("id")),
    })
  );

  c.header("x-response-cache", result.metadata.state);
  return c.json(result.body, result.status);
});
```

## Defaults

- Caches `GET` and `HEAD` by default.
- Uses millisecond TTL values.
- Skips `Set-Cookie`, `private`, and `no-store` responses by default.
- Skips `Authorization` requests unless a `partitionKey` is provided.
- Filters hop-by-hop headers from cached snapshots.
- Uses same-key single-flight protection for concurrent refreshes.

## Concurrent Expiry Protection

If a cached response has `ttl: 2_000` and 10000 identical requests arrive after
it expires, only one request refreshes the origin. The other requests wait for
the same in-flight refresh and return the same updated response snapshot.

Different keys are independent. Failed origin refreshes are not cached, and a
later request can retry.

## Future Batches

`stale-while-revalidate` and tag invalidation are intentionally not part of the
first batch.

- `stale-while-revalidate`: return stale data during a stale window while one
  background refresh updates the cache.
- `tag invalidation`: attach tags to cache entries and invalidate entries by tag
  after business data changes.

Both features need separate API and failure-semantics decisions before they are
implemented.

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
