# response-cache-kit 中文文档

`response-cache-kit` 是 vext 优先的 Node.js 响应缓存工具包，属于 vext 生态的一部分。它的第一验收目标是未来替换 vext 当前响应缓存，同时保持核心 API 不绑定任何 Web 框架。Express、Fastify、Hono、Node 原生 HTTP 和后续 vext adapter 都应复用模块 helper，而不是复制复杂缓存接线代码。

## 目录导航

- [安装](#安装)
- [快速开始](#快速开始)
- [完整配置示例](#完整配置示例)
- [配置说明](#配置说明)
- [单路由覆盖配置](#单路由覆盖配置)
- [标签与失效](#标签与失效)
- [API 参考](#api-参考)
- [框架接入示例](#框架接入示例)
- [默认策略](#默认策略)
- [并发过期保护](#并发过期保护)
- [vext 迁移说明](#vext-迁移说明)
- [后续批次能力](#后续批次能力)
- [测试与压测](#测试与压测)
- [常见问题](#常见问题)
- [许可证](#许可证)

## 安装

```bash
npm install response-cache-kit
```

## 快速开始

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
    headers: { "accept-language": "zh-CN" },
  },
  async () => ({
    status: 200,
    headers: { "content-type": "application/json" },
    body: { id: 42, name: "Keyboard" },
  })
);

console.log(result.metadata.state); // miss / hit / deduped / bypass / error
console.log(
  createResponseCacheWritePayload(result, { cacheControl: true }).headers
); // 包含 X-Cache 和 Cache-Control
```

这个包缓存的是响应快照：status、headers、body、TTL 和 metadata。路由或框架适配层只负责决定何时调用它。

公共响应通常不需要 `partitionKey`。如果响应内容和用户、租户、会话或权限有关，调用 `cache.handle()` 时应传入 `partitionKey` 做隔离。

## 完整配置示例

下面是一个更接近生产接入的例子：全局创建一个响应缓存实例，按语言和租户区域区分缓存，对用户或租户响应传入隔离 key，并把缓存状态写回响应头。

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

只有身份态响应才需要 `partitionKey`。不要把原始 access token 当作 `partitionKey`，应该使用稳定的业务标识，例如用户 ID、租户 ID、组织 ID 或会话 ID。

## 配置说明

### `createResponseCache(options)`

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `cacheHub` | `ResponseCacheHubOptions` | `{}` | 传给内部 `cache-hub` `MemoryCache` 的配置。`defaultTtl` 不开放，响应 TTL 统一由 `ttl` 控制。 |
| `ttl` | `number` | `60000` | 缓存 TTL，单位毫秒。`ttl <= 0` 会 bypass 缓存。 |
| `namespace` | `string` | `"response-cache"` | 缓存 key 前缀。多个模块共用同一个 Store 时建议设置。 |
| `vary` | `readonly string[] \| "*"` | `[]` | 当某些请求头会改变响应内容时，用这些请求头区分缓存。只有明确需要所有请求头参与 key 时才使用 `"*"`。 |
| `tags` | `readonly string[]` | `[]` | 写入缓存时附加的标签。业务数据变更后可用 `cache.invalidateTag(tag)` 失效。 |
| `cacheableMethods` | `readonly string[]` | `["GET", "HEAD"]` | 允许缓存的方法，会自动转为大写。 |
| `cacheableStatuses` | `readonly number[]` | `[200, 203, 204, 206, 300, 301, 404, 410]` | 允许写入缓存的响应状态码。 |
| `allowAuthorizationCache` | `boolean` | `false` | 是否允许缓存带 `Authorization` 的请求。更推荐使用 `partitionKey` 做用户/租户隔离。 |
| `now` | `() => number` | `Date.now` | 时钟函数，主要用于测试和确定性 benchmark。 |
| `keyBuilder` | `ResponseCacheKeyBuilder` | 内置 SHA-256 key builder | 高级缓存 key 构建器。会收到 request、`namespace`、解析后的 `vary` 和 `varyAllHeaders`。 |

`cacheHub` 是配置对象，不是传入外部 Store 实例的入口。`response-cache-kit` 会在内部创建并使用 `cache-hub` Store。

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

`cacheHub` 字段：

| 字段 | 类型 | `cache-hub` 默认值 | 说明 |
|------|------|--------------------|------|
| `maxEntries` | `number` | `10000` | 内部内存 Store 最多保留的条目数。 |
| `maxMemory` | `number` | `0` | 近似内存上限，单位字节。`0` 表示不限制。 |
| `enableStats` | `boolean` | `true` | 是否启用 `cache-hub` Store 统计。 |
| `cleanupInterval` | `number` | `0` | 周期清理间隔，单位毫秒。`0` 表示只做惰性清理。 |
| `enabled` | `boolean` | `true` | 设为 `false` 时临时关闭内部 Store 的读写。 |

`cacheHub` 不开放 `defaultTtl` 和 `enableTags`。响应 TTL 属于 `response-cache-kit`；tag 索引由模块内部启用，因此使用者不需要自己配置底层 Store 才能使用 `invalidateTag()`。

### 缓存多久：`ttl`

`ttl` 表示响应缓存保持新鲜的时间。变化快的数据用短 TTL，变化慢的商品、配置、字典类数据可以用长一点的 TTL。`ttl <= 0` 会跳过缓存，适合临时关闭响应缓存而不改调用代码。

### 缓存 key 前缀：`namespace`

`namespace` 是生成缓存 key 时使用的前缀。多个服务、模块或环境共用同一个缓存进程时，建议设置不同前缀，例如 `"products-api"`、`"admin-api"`、`"staging-products-api"`，避免 key 冲突。

### 按请求头区分缓存：`vary`

`vary` 接受请求头名称，大小写不敏感。但不建议随便加 header，只应该加入确实会改变响应内容的请求头。

推荐场景：

- `accept-language`：不同语言返回不同内容。
- `accept-encoding`：源站返回不同编码后的 body。
- `x-tenant-region`：不同租户区域返回不同内容。
- 客户端版本 header：不同 App 版本返回不同结构。

不推荐：

- `authorization`、`cookie`：身份隔离应使用 `partitionKey`。
- trace id、request id、时间戳、nonce 等每次请求都变化的 header。
- 高基数 header，否则几乎每次请求都会生成一个新的缓存 key。

如果响应会因语言不同而不同，却没有把 `accept-language` 放进 `vary`，不同语言请求可能共用同一份缓存。

`vary: "*"` 表示所有请求头都参与缓存 key。这个配置只适合你非常明确地把“所有 header”视为响应合同的一部分的内部 adapter。公开流量中通常不推荐，因为 request id、trace id、时间、cookie 等高基数字段会让命中率接近 0；如果自定义 keyBuilder 直接拼接 header，还可能暴露敏感信息。常规业务优先使用明确 header 白名单。

### 按用户/租户隔离缓存：`partitionKey`

`partitionKey` 不是 HTTP header，也不会自动从请求中读取。它是调用方传给 `cache.handle()` 的业务隔离字符串，会参与缓存 key。

常见写法：

```typescript
// 公共响应：不传 partitionKey。
{ method: "GET", url: "/products", headers: req.headers }

// 用户响应。
{ method: "GET", url: "/me", headers: req.headers, partitionKey: `user:${userId}` }

// 租户响应。
{ method: "GET", url: "/settings", headers: req.headers, partitionKey: `tenant:${tenantId}` }

// 多租户下的用户响应。
{
  method: "GET",
  url: "/dashboard",
  headers: req.headers,
  partitionKey: `tenant:${tenantId}:user:${userId}`,
}
```

带 `Authorization` 的请求默认会 bypass。提供 `partitionKey` 后，缓存会按这个隔离维度区分用户、租户或会话。不要直接使用原始 token 作为 `partitionKey`。

### 带 Authorization 的请求：`allowAuthorizationCache`

默认值 `false` 是安全默认值，避免一个登录用户的响应被另一个用户复用。

大多数身份态响应都应该使用 `partitionKey`。只有当你明确确认响应不会跨用户泄漏，并且 key 隔离已经足够安全时，才考虑设置 `allowAuthorizationCache: true`。

### 允许缓存的方法和状态码

`cacheableMethods` 默认只允许 `GET` 和 `HEAD`。如果要缓存 `POST`，必须确认这个接口是幂等的，或业务上明确允许缓存这个响应。

`cacheableStatuses` 默认包含常见成功、重定向和负向查找状态。缓存 `404` / `410` 可以减少重复查询不存在资源的压力。不建议默认缓存服务端错误响应。

### 底层 cache-hub 配置：`cacheHub`

`cacheHub` 配置内部 `cache-hub` 内存 Store。它不接受外部 Store 实例。

- `maxEntries`：最多缓存多少个响应。
- `maxMemory`：近似内存上限，单位字节；`0` 表示不显式限制。
- `enableStats`：是否保留 cache-hub Store 统计，便于诊断。
- `cleanupInterval`：周期清理过期条目的间隔；`0` 表示只在访问时惰性清理。
- `enabled`：`true` 时正常读写 Store；`false` 时底层 Store 禁用，请求仍会走 `cache.handle()`，但无法形成有效命中。适合本地调试、临时关闭缓存或灰度排查，不建议生产环境长期关闭。

### 高级自定义 key：`keyBuilder`

`keyBuilder` 是高级逃生口，适合团队已经有统一缓存 key 规范的场景。自定义后，你需要自己把所有影响响应的因素放进 key，例如 URL、规范化 query、`vary` 请求头和 `partitionKey`。

## 标签与失效

tags 是框架无关的批量失效能力。全局 tags 和单次调用 tags 会合并写入底层 `cache-hub` tag 索引。

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

如果只想删除单个 key，可以先构造 key 再删除：

```typescript
const key = cache.makeKey({ method: "GET", url: "/products/42" });
await cache.delete(key);
```

`cache.stats()` 返回底层 `cache-hub` 统计，例如 `entries`、`hits`、`misses`、`hitRate`。`cache.getRemainingTtl(key)` 返回剩余 TTL 毫秒数；如果 key 永不过期返回 `null`，key 不存在或底层不支持 TTL 查询时返回 `undefined`。

## 单路由覆盖配置

全局配置适合大多数路由。单路由覆盖适合某个接口需要不同策略，例如某个接口 TTL 更短，或 `/reports` 这类接口需要缓存 `POST + 202`。

`cacheHub` 不能在单路由覆盖里配置，因为它是底层 Store 的生命周期配置，必须在创建 cache 实例时确定。

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

## API 参考

### `cache.handle(request, origin, options?)`

执行响应缓存流程，并返回标准化响应结果。

`request` 字段：

| 字段 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| `url` | `string` | 是 | 用于缓存 key 的 URL 或 path。query 参数会被规范化。 |
| `method` | `string` | 否 | 默认 `GET`。 |
| `headers` | `HeadersLike` | 否 | 支持普通对象、可迭代 entries、Web `Headers` 风格对象。 |
| `partitionKey` | `string` | 否 | 为用户、租户、会话等身份态响应做缓存隔离。 |

`origin` 返回：

| 字段 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| `body` | `unknown` | 是 | 返回给调用方并可能写入缓存的响应体。 |
| `status` | `number` | 否 | 默认 `200`。 |
| `headers` | `HeadersLike` | 否 | 响应头。写入缓存快照前会过滤 hop-by-hop headers。 |

`handle()` 返回：

| 字段 | 类型 | 说明 |
|------|------|------|
| `status` | `number` | 标准化响应状态码。 |
| `headers` | `Record<string, string>` | 标准化响应头。 |
| `body` | `unknown` | 响应体。 |
| `metadata` | `ResponseCacheMetadata` | 缓存状态、key、原因、age、TTL、是否写入、是否去重等信息。 |

metadata 状态：

| 状态 | 含义 |
|------|------|
| `miss` | 没有可用缓存，已回源。 |
| `hit` | 返回缓存快照。 |
| `deduped` | 同 key 的其他请求正在回源，本请求等待了同一个刷新结果。 |
| `bypass` | 请求策略跳过缓存。 |
| `error` | 保留给框架适配层做错误映射；核心中的 origin 错误会直接抛出。 |

### `cache.makeKey(request, options?)`

只构建缓存 key，不读写 Store。

### `cache.clear()`

清空底层 `cache-hub` Store。

### `cache.delete(key)`

按 key 删除单个响应缓存。默认 key 是 hash；如果框架需要用户可读的删除 key，可以提供 `keyBuilder`，或使用 vext preset 中的 `createVextLegacyKey()`。

### `cache.invalidateTag(tag)`

删除所有带有指定 tag 的响应缓存。

### `cache.stats()`

返回底层 `cache-hub` 统计信息，包括 `entries`、`hits`、`misses`、`hitRate`、`sets`、`deletes` 和内存计数。

### `cache.getRemainingTtl(key)`

返回某个 key 的剩余 TTL 毫秒数；永不过期时返回 `null`，key 不存在或无法查询时返回 `undefined`。

### `createResponseCacheHeaders(result, options?)`

根据 metadata 生成响应缓存头。默认输出 `X-Cache: HIT` 或 `X-Cache: MISS`。设置 `cacheControl: true` 时，会额外输出 `Cache-Control: public,max-age=N`。

### adapter helper

框架 adapter 优先使用这些 helper，减少重复接线：

| Helper | 用途 |
|--------|------|
| `normalizeResponseCacheRequest(input)` | 把框架请求字段转为 `ResponseCacheRequest`。 |
| `createResponseCacheWritePayload(result, options?)` | 合并原始响应头、`X-Cache` 和 `Cache-Control`。 |
| `createResponseCacheCapture(initial?)` | 用于 `_onSend` 或类似机制捕获 status、headers、body。 |

### vext preset helper

`createVextResponseCacheOptions(routeCacheConfig, base?)` 把 vext 风格的 `cache: false | number | { ttl, vary, tags, key, condition }` 转为 `ResponseCacheHandleOptions`。其中 number 和对象里的 `ttl` 都按毫秒理解。`condition` 仍由 adapter 判断：返回 `false` 时直接跳过 `cache.handle()` 并执行原 handler。`createVextLegacyKey()` 会生成 `GET:/products/42` 这类可读 key，方便 vext adapter 保持 `app.cache.delete(key)` 的使用体验。

### `cache.getStore()`

返回底层 `cache-hub` Store，用于诊断或显式生命周期操作。

## 框架接入示例

核心接入方式只有三步：

1. 将框架请求转换为 `ResponseCacheRequest`。
2. 在 `origin` 函数中执行真实业务逻辑。
3. 将 `cache.handle()` 返回的 status、headers、body 和 metadata 写回框架响应。

### Node 原生 HTTP

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

### Express 风格中间件

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

### Fastify 风格 Handler

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

### Hono 风格 Handler

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

### vext 风格 adapter preset

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

## 默认策略

- 默认缓存 `GET` 和 `HEAD`。
- TTL 使用毫秒。
- 默认跳过 `Set-Cookie`、`private`、`no-store` 响应。
- 带 `Authorization` 的请求默认不缓存，除非调用方提供 `partitionKey`。
- 缓存快照会过滤 hop-by-hop headers。
- 默认启用同 key single-flight，避免缓存过期瞬间击穿源站。
- 内部启用 `cache-hub` tag 索引。

## 并发过期保护

如果响应缓存配置为 `ttl: 2_000`，并且同一个 key 在过期后同时收到 10000 个请求，只有一个请求会回源刷新，其余请求等待同一个 in-flight promise，并返回同一份刷新后的响应快照。

不同 key 之间互不阻塞。回源失败时不写缓存，后续请求可以重新回源。

## vext 迁移说明

vext 可以继续保留用户侧 `cache: false | number | RouteCacheOptions` 形态，由 adapter 使用 `createVextResponseCacheOptions()` 归一化。

| vext 行为 | response-cache-kit 支持 |
|-----------|--------------------------|
| `cache: false` | `createVextResponseCacheOptions(false)` 返回 `false`。 |
| `cache: number` | number 按毫秒处理。 |
| 对象 `ttl` | 对象里的 `ttl` 同样按毫秒处理。 |
| `vary` | 传给核心 `vary`，必要时可显式使用 `vary: "*"`。 |
| `tags` | 写入 `cache-hub` tag 索引，并通过 `invalidateTag()` 失效。 |
| 可读删除 key | `createVextLegacyKey()` 生成 `GET:/products` 这类 key。 |
| `X-Cache` / `Cache-Control` | `createResponseCacheWritePayload(result, { cacheControl: true })`。 |
| 204 / 非 2xx 不缓存 | `VEXT_CACHEABLE_STATUSES` 包含除 204 外的 2xx。 |

## 后续批次能力

`stale-while-revalidate` 不在当前批次实现范围内。

- `stale-while-revalidate`：fresh TTL 过期后，在 stale window 内先返回旧值，同时后台刷新。

它需要单独确认 API、失败语义、测试与压测策略后再实现。

## 测试与压测

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

当前覆盖率门禁要求 lines、functions、branches、statements 全部达到 100%。

`npm run benchmark` 包含 `expired-race-10000-same-key` 场景，期望 `originCalls` 为 `1`。

## 常见问题

### 为什么请求一直是 `bypass`？

优先检查请求方法、请求头、响应头和 TTL：

- 非 `GET` / `HEAD` 方法默认 bypass，除非加入 `cacheableMethods`。
- `ttl <= 0` 会跳过缓存。
- 带 `Authorization` 的请求默认 bypass，除非提供 `partitionKey` 或开启 `allowAuthorizationCache`。
- 响应带 `Set-Cookie`、`Cache-Control: private`、`Cache-Control: no-store` 时默认 bypass。

### 为什么一直是 `miss`？

通常是每次请求生成了不同的缓存 key。请检查 `url`、query 参数、`partitionKey` 和 `vary` 请求头。不要把 request id、trace id、时间戳或原始 token 放进 key 相关输入。

### 如何安全缓存登录后的响应？

优先使用 `partitionKey`。用户级数据可以用 `user:${userId}`，多租户用户数据可以用 `tenant:${tenantId}:user:${userId}`。不要把原始 access token 作为 `partitionKey`。

### 多语言或多区域响应怎么避免串缓存？

把影响响应内容的请求头加入 `vary`：

```typescript
createResponseCache({
  ttl: 30_000,
  vary: ["accept-language", "x-tenant-region"],
});
```

### `cacheHub.enabled=false` 后会发生什么？

内部 `cache-hub` Store 会停止读写，因此不会产生持久缓存命中。调用仍然会经过 `cache.handle()`，同一波同 key 的并发请求仍可能被 single-flight 合并，但这一波结束后不会复用已存储的值。这个配置适合本地调试或临时关闭缓存，不建议作为长期生产配置。

### 能接 Redis 或多级缓存吗？

`cache-hub` 是唯一运行时缓存底座。Redis、多级缓存等能力应作为单独的 cache-hub 接入批次设计，不通过 `response-cache-kit` 的外部 Store 配置开放。

### 为什么 `npm run benchmark` 比单测更重？

它会执行 10000 个同 key 过期并发请求，用来验证并发过期保护。期望 `originCalls` 为 `1`。

## 许可证

Apache-2.0
