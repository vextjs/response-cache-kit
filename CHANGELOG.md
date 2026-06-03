# Changelog

## 目录导航

- [Unreleased](#unreleased)
- [1.2.0 - 2026-06-03](#120---2026-06-03)
- [1.1.0 - 2026-06-03](#110---2026-06-03)
- [1.0.1 - 2026-06-03](#101---2026-06-03)
- [1.0.0 - 2026-06-02](#100---2026-06-02)

## Unreleased

- No unreleased changes.

## 1.2.0 - 2026-06-03

- Add `cacheHub.mode: "redis"` and `"multi-level"` runtime options backed by `cache-hub@^2.2.0`.
- Add Redis lease coordination for cross-process same-key refresh protection.
- Add optional distributed tag invalidation and optional `cache.close?.()` lifecycle support.
- Make `cache.clear()` invalidate the current response cache namespace by internal tag, avoiding Redis `flushdb`.
- Fix `Cache-Control` helpers so unstored responses never receive a new public `max-age`.
- Expand English and Chinese docs with full Memory/Redis/MultiLevel/lease/distributed configuration, lifecycle notes, and Redis troubleshooting.

## 1.1.0 - 2026-06-03

- Add response cache tags, tag invalidation, key deletion, stats, and remaining TTL APIs.
- Add `X-Cache` / `Cache-Control` header helpers and framework adapter helpers.
- Add a vext preset for millisecond-based route cache options, readable legacy keys, and 2xx-except-204 status behavior.
- Support `vary: "*"` for explicit all-request-header key variation.
- Expand English and Chinese docs with full API, tag invalidation, adapter helpers, framework examples, and vext migration notes.

## 1.0.1 - 2026-06-03

- Remove source map files from npm package output.
- Add a package boundary check that fails when `npm pack` includes `.map` files.
- Run the package boundary check in CI, publish workflow, and `prepublishOnly`.

## 1.0.0 - 2026-06-02

- Initialize `response-cache-kit` as a framework-agnostic response caching toolkit.
- Add `cache-hub` as the default and only runtime caching dependency.
- Add esbuild-based ESM/CJS builds and TypeScript declaration output.
- Add single-flight protection for same-key concurrent refreshes.
- Add unit tests, benchmark scripts, and same-category comparison entry points.
- Add Chinese documentation and framework integration examples.
- Raise same-key expired-race benchmark coverage to 10000 concurrent requests.
- Replace the standalone naming explanation with concise positioning and add full configuration/API reference tables.
- Replace external store injection with `cacheHub` configuration for the internal `cache-hub` store.
- Expand README and Chinese docs with user-facing configuration guidance, complete examples, partition key guidance, and troubleshooting.
- Add GitHub Actions CI and tag-based npm publishing workflows.
