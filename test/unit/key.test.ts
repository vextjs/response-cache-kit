import { describe, expect, it } from "vitest";
import { createResponseCacheKey, normalizeUrl } from "../../src/index.js";

describe("createResponseCacheKey", () => {
  it("normalizes query order", () => {
    const a = createResponseCacheKey(
      { method: "GET", url: "/items?b=2&a=1" },
      { namespace: "test" }
    );
    const b = createResponseCacheKey(
      { method: "GET", url: "/items?a=1&b=2" },
      { namespace: "test" }
    );

    expect(a).toBe(b);
  });

  it("includes vary headers and partition keys", () => {
    const base = createResponseCacheKey(
      {
        method: "GET",
        url: "/items",
        headers: { "accept-language": "en" },
        partitionKey: "tenant-a",
      },
      { namespace: "test", vary: ["accept-language"] }
    );
    const other = createResponseCacheKey(
      {
        method: "GET",
        url: "/items",
        headers: { "accept-language": "zh" },
        partitionKey: "tenant-a",
      },
      { namespace: "test", vary: ["accept-language"] }
    );

    expect(base).not.toBe(other);
  });

  it("uses custom key builders", () => {
    expect(
      createResponseCacheKey(
        { method: "GET", url: "/items" },
        {
          namespace: "test",
          vary: ["accept"],
          keyBuilder: (_request, context) =>
            `${context.namespace}:${context.vary.join(",")}:${context.varyAllHeaders}`,
        }
      )
    ).toBe("test:accept:false");
  });

  it("supports using all request headers as vary inputs", () => {
    const english = createResponseCacheKey(
      {
        method: "GET",
        url: "/items",
        headers: { "accept-language": "en", "x-version": "1" },
      },
      { namespace: "test", vary: "*" }
    );
    const chinese = createResponseCacheKey(
      {
        method: "GET",
        url: "/items",
        headers: { "accept-language": "zh", "x-version": "1" },
      },
      { namespace: "test", vary: "*" }
    );

    expect(english).not.toBe(chinese);
    expect(
      createResponseCacheKey(
        { method: "GET", url: "/items", headers: { a: "1" } },
        {
          namespace: "test",
          vary: "*",
          keyBuilder: (_request, context) =>
            `${context.vary.join(",")}:${context.varyAllHeaders}`,
        }
      )
    ).toBe("a:true");
  });

  it("uses the default namespace and ignores missing vary headers", () => {
    expect(
      createResponseCacheKey(
        { method: "GET", url: "/items", headers: {} },
        { vary: ["accept-language"] }
      )
    ).toMatch(/^response-cache:v1:/);
  });

  it("keeps absolute URL origins in the normalized key payload", () => {
    expect(normalizeUrl("https://example.com/a?b=2&a=1")).toBe(
      "https://example.com/a?a=1&b=2"
    );
  });

  it("sorts duplicate query keys by value", () => {
    expect(normalizeUrl("/items?b=2&b=1")).toBe("/items?b=1&b=2");
  });

  it("returns invalid URLs unchanged", () => {
    expect(normalizeUrl("http://[invalid")).toBe("http://[invalid");
  });
});
