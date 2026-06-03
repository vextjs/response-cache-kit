import { describe, expect, it } from "vitest";
import {
  VEXT_CACHEABLE_STATUSES,
  createVextLegacyKey,
  createVextResponseCacheOptions,
  secondsToMilliseconds,
} from "../../src/index.js";

describe("vext preset", () => {
  it("keeps vext cacheable statuses to 2xx except 204", () => {
    expect(secondsToMilliseconds(2)).toBe(2_000);
    expect(VEXT_CACHEABLE_STATUSES).toContain(200);
    expect(VEXT_CACHEABLE_STATUSES).toContain(299);
    expect(VEXT_CACHEABLE_STATUSES).not.toContain(204);
    expect(VEXT_CACHEABLE_STATUSES).not.toContain(300);
  });

  it("maps route cache config to response-cache options", () => {
    expect(createVextResponseCacheOptions(false)).toBe(false);

    const numeric = createVextResponseCacheOptions(2_000);
    expect(numeric).toMatchObject({
      ttl: 2_000,
      cacheableStatuses: VEXT_CACHEABLE_STATUSES,
    });
    expect(numeric && numeric.keyBuilder).toBe(createVextLegacyKey);

    const customKey = () => "custom";
    const object = createVextResponseCacheOptions(
      {
        ttl: 3_000,
        vary: "*",
        tags: ["products"],
        key: customKey,
        cacheableStatuses: [200],
        allowAuthorizationCache: true,
      },
      { namespace: "base", ttl: 1_000 }
    );

    expect(object).toEqual({
      namespace: "base",
      ttl: 3_000,
      vary: "*",
      tags: ["products"],
      keyBuilder: customKey,
      cacheableStatuses: [200],
      allowAuthorizationCache: true,
    });
  });

  it("creates readable legacy keys for vext-compatible deletion", () => {
    expect(
      createVextLegacyKey(
        {
          method: "GET",
          url: "/products?b=2&a=1",
          headers: { "accept-language": "zh-CN" },
          partitionKey: "tenant:1",
        },
        { vary: ["accept-language", "missing"] }
      )
    ).toBe("GET:/products?a=1&b=2|partition=tenant:1|accept-language=zh-CN");

    expect(createVextLegacyKey({ url: "/products" }, { vary: [] })).toBe(
      "GET:/products"
    );
  });
});
