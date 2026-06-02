# Changelog

## 目录导航

- [1.0.1 - 2026-06-03](#101---2026-06-03)
- [1.0.0 - 2026-06-02](#100---2026-06-02)

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
