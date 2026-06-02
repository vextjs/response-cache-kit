import { describe, expect, it, vi } from "vitest";
import { createResponseCache } from "../../src/index.js";

describe("response cache", () => {
  it("writes on miss and serves later hits from cache", async () => {
    const cache = createResponseCache({ ttl: 1_000 });
    const origin = vi.fn(async () => ({
      status: 200,
      headers: { "content-type": "application/json" },
      body: { value: 1 },
    }));

    const first = await cache.handle({ method: "GET", url: "/data" }, origin);
    const second = await cache.handle({ method: "GET", url: "/data" }, origin);

    expect(origin).toHaveBeenCalledTimes(1);
    expect(first.metadata.state).toBe("miss");
    expect(second.metadata.state).toBe("hit");
    expect(second.body).toEqual({ value: 1 });
  });

  it("bypasses ttl=0 and does not write cache", async () => {
    const cache = createResponseCache({ ttl: 0 });
    const origin = vi.fn(async () => ({
      status: 200,
      body: "fresh",
    }));

    await cache.handle({ method: "GET", url: "/data" }, origin);
    await cache.handle({ method: "GET", url: "/data" }, origin);

    expect(origin).toHaveBeenCalledTimes(2);
  });

  it("dedupes 10000 concurrent requests after a 2s ttl expires", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    try {
      const cache = createResponseCache({ ttl: 2_000 });
      let originCalls = 0;
      const origin = vi.fn(async () => {
        originCalls++;
        await Promise.resolve();
        return {
          status: 200,
          headers: { "content-type": "application/json" },
          body: { version: originCalls },
        };
      });

      await cache.handle({ method: "GET", url: "/hot" }, origin);
      expect(origin).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(2_001);

      const results = await Promise.all(
        Array.from({ length: 10_000 }, () =>
          cache.handle({ method: "GET", url: "/hot" }, origin)
        )
      );

      expect(origin).toHaveBeenCalledTimes(2);
      expect(results).toHaveLength(10_000);
      expect(results.every((result) => result.body && typeof result.body === "object")).toBe(
        true
      );
      expect(
        results.filter((result) => result.metadata.state === "miss")
      ).toHaveLength(1);
      expect(
        results.filter((result) => result.metadata.state === "deduped")
      ).toHaveLength(9_999);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not share single-flight state across different keys", async () => {
    const cache = createResponseCache({ ttl: 1_000 });
    const origin = vi.fn(async () => {
      await Promise.resolve();
      return { status: 200, body: "ok" };
    });

    await Promise.all([
      cache.handle({ method: "GET", url: "/a" }, origin),
      cache.handle({ method: "GET", url: "/b" }, origin),
    ]);

    expect(origin).toHaveBeenCalledTimes(2);
  });

  it("shares same-key origin failures and allows a later retry", async () => {
    const cache = createResponseCache({ ttl: 1_000 });
    let shouldFail = true;
    const origin = vi.fn(async () => {
      await Promise.resolve();
      if (shouldFail) {
        throw new Error("origin failed");
      }
      return { status: 200, body: "recovered" };
    });

    const failed = await Promise.allSettled([
      cache.handle({ method: "GET", url: "/unstable" }, origin),
      cache.handle({ method: "GET", url: "/unstable" }, origin),
    ]);

    expect(failed.every((result) => result.status === "rejected")).toBe(true);
    expect(origin).toHaveBeenCalledTimes(1);

    shouldFail = false;
    const recovered = await cache.handle(
      { method: "GET", url: "/unstable" },
      origin
    );

    expect(origin).toHaveBeenCalledTimes(2);
    expect(recovered.body).toBe("recovered");
  });

  it("returns bypass metadata with reasons for request policy bypass", async () => {
    const cache = createResponseCache({ ttl: 1_000 });
    const result = await cache.handle(
      { method: "POST", url: "/submit" },
      async () => ({ status: 201, body: "created" })
    );

    expect(result.metadata).toEqual({
      state: "bypass",
      reason: "method-not-cacheable",
    });
  });

  it("returns bypass metadata without reason when a custom policy has no reason", async () => {
    const cache = createResponseCache({ ttl: -1 });
    const result = await cache.handle(
      { method: "GET", url: "/submit" },
      async () => ({ status: 200, body: "uncached" })
    );

    expect(result.metadata.state).toBe("bypass");
    expect(result.metadata.reason).toBe("ttl-disabled");
  });

  it("marks non-cacheable origin responses as unstored misses", async () => {
    const cache = createResponseCache({ ttl: 1_000 });
    const result = await cache.handle(
      { method: "GET", url: "/private" },
      async () => ({
        status: 200,
        headers: { "cache-control": "private" },
        body: "private",
      })
    );

    expect(result.metadata.state).toBe("miss");
    expect(result.metadata.stored).toBe(false);
    expect(result.metadata.reason).toBe("response-private");
  });

  it("marks cache write failures without failing origin responses", async () => {
    const cache = createResponseCache({ ttl: 1_000 });
    cache.getStore().set = async () => {
      throw new Error("set failed");
    };
    const result = await cache.handle(
      { method: "GET", url: "/write-fail" },
      async () => ({ status: 200, body: "ok" })
    );

    expect(result.metadata.cacheWriteError).toBe(true);
    expect(result.metadata.reason).toBe("cache-write-failed");
  });

  it("treats cache read failures as misses", async () => {
    let sets = 0;
    const cache = createResponseCache({ ttl: 1_000 });
    const store = cache.getStore();
    store.get = async () => {
      throw new Error("get failed");
    };
    store.set = async () => {
      sets++;
    };
    const result = await cache.handle(
      { method: "GET", url: "/read-fail" },
      async () => ({ status: 200, body: "ok" })
    );

    expect(result.metadata.state).toBe("miss");
    expect(sets).toBe(1);
  });

  it("supports clear, getStore, makeKey, cache-hub options, and per-call overrides", async () => {
    let now = 100;
    const cache = createResponseCache({
      ttl: 1_000,
      cacheHub: { maxEntries: 2 },
      namespace: "base",
      now: () => now,
      keyBuilder: (_request, context) => `${context.namespace}:custom`,
    });

    expect(cache.getStore()).toBeTruthy();
    expect(cache.makeKey({ method: "GET", url: "/x" })).toBe("base:custom");
    expect(
      cache.makeKey(
        { method: "GET", url: "/x" },
        {
          namespace: "override",
          vary: ["accept"],
          keyBuilder: (_request, context) =>
            `${context.namespace}:${context.vary.join("|")}`,
        }
      )
    ).toBe("override:accept");

    const first = await cache.handle(
      { method: "POST", url: "/override" },
      async () => ({ status: 202, body: "accepted" }),
      {
        cacheableMethods: ["POST"],
        cacheableStatuses: [202],
        ttl: 500,
        allowAuthorizationCache: true,
        now: () => now,
      }
    );
    expect(first.metadata.state).toBe("miss");

    now = 200;
    const second = await cache.handle(
      { method: "POST", url: "/override" },
      async () => ({ status: 202, body: "new" }),
      {
        cacheableMethods: ["POST"],
        cacheableStatuses: [202],
        ttl: 500,
        allowAuthorizationCache: true,
        now: () => now,
      }
    );
    expect(second.metadata.state).toBe("hit");
    expect(second.body).toBe("accepted");

    await cache.clear();
    const third = await cache.handle(
      { method: "GET", url: "/after-clear" },
      async () => ({ status: 200, body: "fresh" })
    );
    expect(third.metadata.state).toBe("miss");
  });

  it("uses default options when no constructor options are provided", async () => {
    const cache = createResponseCache();
    const result = await cache.handle(
      { url: "/default" },
      async () => ({ body: "default" })
    );

    expect(result.status).toBe(200);
    expect(result.metadata.state).toBe("miss");
    expect(cache.makeKey({ url: "/default" })).toMatch(/^response-cache:v1:/);
  });
});
