import { describe, expect, it } from "vitest";
import {
  DEFAULT_CACHEABLE_METHODS,
  DEFAULT_CACHEABLE_STATUSES,
  evaluateRequestPolicy,
  evaluateResponsePolicy,
} from "../../src/index.js";
import { normalizeMethod } from "../../src/policy.js";
import { createMemoryResponseCacheStore } from "../../src/store.js";

const baseOptions = {
  cache: createMemoryResponseCacheStore(),
  ttl: 1_000,
  namespace: "test",
  vary: [],
  tags: [],
  cacheableMethods: new Set(DEFAULT_CACHEABLE_METHODS),
  cacheableStatuses: new Set(DEFAULT_CACHEABLE_STATUSES),
  allowAuthorizationCache: false,
  now: Date.now,
};

describe("policy", () => {
  it("bypasses non-safe methods", () => {
    expect(
      evaluateRequestPolicy({ method: "POST", url: "/submit" }, baseOptions)
    ).toEqual({ cacheable: false, reason: "method-not-cacheable" });
  });

  it("bypasses disabled ttl and request cache-control directives", () => {
    expect(
      evaluateRequestPolicy({ method: "GET", url: "/x" }, {
        ...baseOptions,
        ttl: 0,
      })
    ).toEqual({ cacheable: false, reason: "ttl-disabled" });
    expect(
      evaluateRequestPolicy(
        {
          method: "GET",
          url: "/x",
          headers: { "cache-control": "no-store" },
        },
        baseOptions
      )
    ).toEqual({ cacheable: false, reason: "request-no-store" });
    expect(
      evaluateRequestPolicy(
        {
          method: "GET",
          url: "/x",
          headers: { "cache-control": "no-cache" },
        },
        baseOptions
      )
    ).toEqual({ cacheable: false, reason: "request-no-cache" });
  });

  it("bypasses authorization without a partition key", () => {
    expect(
      evaluateRequestPolicy(
        {
          method: "GET",
          url: "/me",
          headers: { authorization: "Bearer token" },
        },
        baseOptions
      )
    ).toEqual({
      cacheable: false,
      reason: "authorization-without-partition",
    });
  });

  it("allows authorization when a partition key is provided", () => {
    expect(
      evaluateRequestPolicy(
        {
          method: "GET",
          url: "/me",
          headers: { authorization: "Bearer token" },
          partitionKey: "user:1",
        },
        baseOptions
      )
    ).toEqual({ cacheable: true });
  });

  it("rejects responses with Set-Cookie", () => {
    expect(
      evaluateResponsePolicy(
        { status: 200, headers: { "set-cookie": "sid=1" }, body: "ok" },
        { "set-cookie": "sid=1" },
        baseOptions
      )
    ).toEqual({ cacheable: false, reason: "set-cookie" });
  });

  it("rejects non-cacheable response statuses and cache-control directives", () => {
    expect(
      evaluateResponsePolicy({ status: 500, body: "fail" }, {}, baseOptions)
    ).toEqual({ cacheable: false, reason: "status-not-cacheable" });
    expect(
      evaluateResponsePolicy(
        { status: 200, headers: { "cache-control": "no-store" }, body: "ok" },
        { "cache-control": "no-store" },
        baseOptions
      )
    ).toEqual({ cacheable: false, reason: "response-no-store" });
    expect(
      evaluateResponsePolicy(
        { status: 200, headers: { "cache-control": "private" }, body: "ok" },
        { "cache-control": "private" },
        baseOptions
      )
    ).toEqual({ cacheable: false, reason: "response-private" });
  });

  it("normalizes default status and allows cacheable responses", () => {
    expect(evaluateResponsePolicy({ body: "ok" }, {}, baseOptions)).toEqual({
      cacheable: true,
    });
  });

  it("defaults missing methods to GET", () => {
    expect(normalizeMethod()).toBe("GET");
  });
});
