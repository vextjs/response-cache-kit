import { describe, expect, it } from "vitest";
import {
  createResponseCacheHeaders,
  getMaxAgeSeconds,
  toCacheHeaderValue,
} from "../../src/index.js";
import type { ResponseCacheResult } from "../../src/index.js";

const baseResult: ResponseCacheResult = {
  status: 200,
  headers: {},
  body: "ok",
  metadata: {
    state: "hit",
    ttl: 2_000,
    age: 750,
    stored: true,
  },
};

describe("cache headers", () => {
  it("maps hit and miss-like states to X-Cache values", () => {
    expect(toCacheHeaderValue("hit")).toBe("HIT");
    expect(toCacheHeaderValue("miss")).toBe("MISS");
    expect(toCacheHeaderValue("deduped")).toBe("MISS");
    expect(toCacheHeaderValue("bypass")).toBe("MISS");
    expect(toCacheHeaderValue("error")).toBe("MISS");
  });

  it("creates X-Cache and Cache-Control headers", () => {
    expect(
      createResponseCacheHeaders(baseResult, { cacheControl: true })
    ).toEqual({
      "X-Cache": "HIT",
      "Cache-Control": "public,max-age=2",
    });
  });

  it("supports custom header names, private cache-control, and disabled cache header", () => {
    expect(
      createResponseCacheHeaders(baseResult, {
        cacheHeaderName: false,
        cacheControl: true,
        cacheControlHeaderName: "Surrogate-Control",
        cacheControlScope: "private",
      })
    ).toEqual({
      "Surrogate-Control": "private,max-age=2",
    });

    expect(
      createResponseCacheHeaders(baseResult, {
        cacheHeaderName: "X-Response-Cache",
      })
    ).toEqual({
      "X-Response-Cache": "HIT",
    });
  });

  it("omits Cache-Control when ttl metadata is unavailable", () => {
    const result: ResponseCacheResult = {
      ...baseResult,
      metadata: { state: "bypass" },
    };

    expect(getMaxAgeSeconds(result)).toBeUndefined();
    expect(createResponseCacheHeaders(result, { cacheControl: true })).toEqual({
      "X-Cache": "MISS",
    });
  });

  it("omits Cache-Control when a stored result has no ttl metadata", () => {
    const result: ResponseCacheResult = {
      ...baseResult,
      metadata: { state: "hit", stored: true },
    };

    expect(getMaxAgeSeconds(result)).toBeUndefined();
    expect(createResponseCacheHeaders(result, { cacheControl: true })).toEqual({
      "X-Cache": "HIT",
    });
  });

  it("omits Cache-Control when the response was not stored", () => {
    const result: ResponseCacheResult = {
      ...baseResult,
      metadata: { state: "miss", ttl: 2_000, age: 0, stored: false },
    };

    expect(getMaxAgeSeconds(result)).toBeUndefined();
    expect(createResponseCacheHeaders(result, { cacheControl: true })).toEqual({
      "X-Cache": "MISS",
    });
  });

  it("uses zero age when age metadata is missing", () => {
    expect(
      getMaxAgeSeconds({
        ...baseResult,
        metadata: { state: "miss", ttl: 1_000, stored: true },
      })
    ).toBe(1);
  });
});
