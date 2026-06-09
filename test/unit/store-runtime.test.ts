import { describe, expect, it, vi } from "vitest";
import {
  clearResponseCacheRuntime,
  createResponseCacheNamespaceTag,
  createResponseCacheRuntime,
  invalidateResponseCacheTag,
  setResponseSnapshot,
} from "../../src/store.js";
import { createResponseCache, createResponseCacheWritePayload } from "../../src/index.js";
import type { CacheLike } from "cache-hub";
import type {
  ResponseCacheRuntime,
  ResponseSnapshot,
} from "../../src/types.js";

interface FakeEntry {
  value: string;
  expiresAt?: number;
}

class FakePipeline {
  private readonly operations: Array<() => Promise<unknown> | unknown> = [];

  constructor(private readonly redis: FakeRedis) {}

  set(key: string, value: string, ...args: Array<string | number>) {
    this.operations.push(() => this.redis.set(key, value, ...args));
    return this;
  }

  del(...keys: string[]) {
    this.operations.push(() => this.redis.del(...keys));
    return this;
  }

  unlink(...keys: string[]) {
    this.operations.push(() => this.redis.unlink(...keys));
    return this;
  }

  sadd(key: string, ...values: string[]) {
    this.operations.push(() => this.redis.sadd(key, ...values));
    return this;
  }

  srem(key: string, ...values: string[]) {
    this.operations.push(() => this.redis.srem(key, ...values));
    return this;
  }

  pttl(key: string) {
    this.operations.push(() => this.redis.pttl(key));
    return this;
  }

  async exec(): Promise<Array<[null, unknown]>> {
    const results: Array<[null, unknown]> = [];
    for (const operation of this.operations) {
      results.push([null, await operation()]);
    }
    return results;
  }
}

class FakeRedis {
  readonly data = new Map<string, FakeEntry>();
  readonly sets = new Map<string, Set<string>>();
  readonly published: string[] = [];
  readonly options = { host: "localhost", port: 6379 };
  leaseAcquireFailures = 0;
  blockLeases = false;
  throwOnRelease = false;
  quitCalls = 0;

  on(_event: string, _handler: (...args: unknown[]) => void) {
    return this;
  }

  subscribe(_channel: string, callback?: (err: Error | null, count: number) => void) {
    callback?.(null, 1);
    return Promise.resolve(1);
  }

  unsubscribe(_channel: string) {
    return Promise.resolve(1);
  }

  publish(channel: string, message: string) {
    this.published.push(`${channel}:${message}`);
    return Promise.resolve(1);
  }

  quit() {
    this.quitCalls += 1;
    return Promise.resolve("OK");
  }

  pipeline() {
    return new FakePipeline(this);
  }

  async get(key: string): Promise<string | null> {
    this.expireIfNeeded(key);
    return this.data.get(key)?.value ?? null;
  }

  async set(
    key: string,
    value: string,
    ...args: Array<string | number>
  ): Promise<"OK" | null> {
    const nx = args.includes("NX");
    const pxIndex = args.indexOf("PX");

    if (nx) {
      if (this.blockLeases) {
        return null;
      }
      if (this.leaseAcquireFailures > 0) {
        this.leaseAcquireFailures -= 1;
        return null;
      }
      this.expireIfNeeded(key);
      if (this.data.has(key)) {
        return null;
      }
    }

    const ttl = pxIndex >= 0 ? Number(args[pxIndex + 1]) : undefined;
    const entry: FakeEntry = { value };
    if (ttl !== undefined && Number.isFinite(ttl) && ttl > 0) {
      entry.expiresAt = Date.now() + ttl;
    }
    this.data.set(key, entry);
    return "OK";
  }

  async del(...keys: string[]): Promise<number> {
    let deleted = 0;
    for (const key of keys) {
      const hadData = this.data.delete(key);
      const hadSet = this.sets.delete(key);
      if (hadData || hadSet) {
        deleted += 1;
      }
    }
    return deleted;
  }

  async unlink(...keys: string[]): Promise<number> {
    return this.del(...keys);
  }

  async exists(key: string): Promise<number> {
    this.expireIfNeeded(key);
    return this.data.has(key) ? 1 : 0;
  }

  async flushdb(): Promise<"OK"> {
    this.data.clear();
    this.sets.clear();
    return "OK";
  }

  async mget(...keys: string[]): Promise<Array<string | null>> {
    const values: Array<string | null> = [];
    for (const key of keys) {
      values.push(await this.get(key));
    }
    return values;
  }

  async pttl(key: string): Promise<number> {
    this.expireIfNeeded(key);
    const entry = this.data.get(key);
    if (!entry) {
      return -2;
    }
    if (entry.expiresAt === undefined) {
      return -1;
    }
    return Math.max(1, entry.expiresAt - Date.now());
  }

  async sadd(key: string, ...values: string[]): Promise<number> {
    const set = this.sets.get(key) ?? new Set<string>();
    let added = 0;
    for (const value of values) {
      if (!set.has(value)) {
        added += 1;
      }
      set.add(value);
    }
    this.sets.set(key, set);
    return added;
  }

  async srem(key: string, ...values: string[]): Promise<number> {
    const set = this.sets.get(key);
    if (!set) {
      return 0;
    }
    let removed = 0;
    for (const value of values) {
      if (set.delete(value)) {
        removed += 1;
      }
    }
    if (set.size === 0) {
      this.sets.delete(key);
    }
    return removed;
  }

  async smembers(key: string): Promise<string[]> {
    return Array.from(this.sets.get(key) ?? []);
  }

  async sscan(
    key: string,
    _cursor: string,
    _countKeyword: "COUNT",
    _count: number
  ): Promise<[string, string[]]> {
    return ["0", await this.smembers(key)];
  }

  async scan(
    _cursor: string,
    _matchKeyword: "MATCH",
    pattern: string,
    _countKeyword: "COUNT",
    _count: number
  ): Promise<[string, string[]]> {
    const matched = Array.from(this.data.keys()).filter((key) =>
      matchesRedisPattern(key, pattern)
    );
    return ["0", matched];
  }

  async eval(
    script: string,
    _keyCount: number,
    key: string,
    token: string,
    ttl?: number
  ): Promise<number> {
    const current = await this.get(key);
    if (current !== token) {
      return 0;
    }
    if (script.includes("PEXPIRE")) {
      const entry = this.data.get(key);
      if (entry && ttl !== undefined) {
        entry.expiresAt = Date.now() + Number(ttl);
      }
      return 1;
    }
    if (this.throwOnRelease) {
      throw new Error("release failed");
    }
    this.data.delete(key);
    return 1;
  }

  private expireIfNeeded(key: string): void {
    const entry = this.data.get(key);
    if (entry?.expiresAt !== undefined && entry.expiresAt <= Date.now()) {
      this.data.delete(key);
    }
  }
}

function matchesRedisPattern(key: string, pattern: string): boolean {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`).test(key);
}

function snapshot(body: unknown, ttl = 1_000): ResponseSnapshot {
  return {
    status: 200,
    headers: {},
    body,
    createdAt: Date.now(),
    ttl,
  };
}

function createBareRuntime(cache: Partial<CacheLike>): ResponseCacheRuntime {
  return {
    cache: cache as CacheLike,
    async close() {},
  };
}

describe("response cache runtime", () => {
  it("keeps memory mode compatible and clears only the current namespace tag", async () => {
    const runtime = createResponseCacheRuntime(
      {
        maxEntries: 10,
        maxMemory: 1024 * 1024,
        enableStats: true,
        cleanupInterval: 60_000,
        enabled: true,
      },
      1_000
    );
    const namespaceA = createResponseCacheNamespaceTag("a");
    const namespaceB = createResponseCacheNamespaceTag("b");

    await setResponseSnapshot(
      runtime.cache,
      "a-key",
      snapshot("a"),
      1_000,
      ["shared"],
      namespaceA
    );
    await setResponseSnapshot(
      runtime.cache,
      "b-key",
      snapshot("b"),
      1_000,
      ["shared"],
      namespaceB
    );

    await clearResponseCacheRuntime(runtime, namespaceA);

    expect(await runtime.cache.get("a-key")).toBeUndefined();
    expect(await runtime.cache.get("b-key")).toMatchObject({
      body: "b",
    });
    await runtime.close();
  });

  it("falls back to clear when a store has no tag invalidation helper", async () => {
    const clear = vi.fn();
    const runtime = createBareRuntime({ clear });

    await clearResponseCacheRuntime(runtime, "namespace");

    expect(clear).toHaveBeenCalledTimes(1);
  });

  it("uses a distributed invalidator when runtime clear or tag invalidation is distributed", async () => {
    const distributed = {
      invalidateTag: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
    };
    const runtime: ResponseCacheRuntime = {
      cache: {} as CacheLike,
      distributed,
      async close() {
        await distributed.close();
      },
    };

    await clearResponseCacheRuntime(runtime, "namespace");
    await invalidateResponseCacheTag(runtime, "products");
    await runtime.close();

    expect(distributed.invalidateTag).toHaveBeenCalledWith("namespace");
    expect(distributed.invalidateTag).toHaveBeenCalledWith("products");
    expect(distributed.close).toHaveBeenCalledTimes(1);
  });

  it("creates redis runtime with tags, lease options, and external-client close semantics", async () => {
    const client = new FakeRedis();
    const runtime = createResponseCacheRuntime(
      {
        mode: "redis",
        client,
        metaKeyPrefix: "rck:test",
        scanCount: 10,
        deleteCommand: "unlink",
        lease: {
          ttl: 25,
          waitForOwner: 30,
          pollInterval: 2,
          onTimeout: "throw",
          keyPrefix: "rck:lease",
          ownerId: "owner",
        },
        distributed: false,
      },
      1_000
    );

    expect(runtime.lease).toEqual({
      ttl: 25,
      waitForOwner: 30,
      pollInterval: 2,
      onTimeout: "throw",
    });

    const lease = await runtime.leaseStore?.acquireLease("hot", 25);
    expect(lease?.token.startsWith("owner:")).toBe(true);
    await expect(lease?.renew(30)).resolves.toBe(true);
    await expect(lease?.release()).resolves.toBe(true);

    await setResponseSnapshot(
      runtime.cache,
      "redis-key",
      snapshot({ ok: true }),
      1_000,
      ["products"],
      createResponseCacheNamespaceTag("redis")
    );
    await invalidateResponseCacheTag(runtime, "products");

    expect(await runtime.cache.get("redis-key")).toBeUndefined();
    await runtime.close();
    expect(client.quitCalls).toBe(0);
  });

  it("keeps redis lease disabled for false or disabled lease config", async () => {
    const falseLease = createResponseCacheRuntime(
      { mode: "redis", client: new FakeRedis(), lease: false },
      1_000
    );
    const disabledLease = createResponseCacheRuntime(
      { mode: "redis", client: new FakeRedis(), lease: { enabled: false } },
      1_000
    );

    expect(falseLease.leaseStore).toBeUndefined();
    expect(disabledLease.leaseStore).toBeUndefined();
    await falseLease.close();
    await disabledLease.close();
  });

  it("uses cache-hub redis URL and default URL paths only when redis mode is explicit", async () => {
    const runtimes: Array<{ close(): Promise<void> }> = [];
    const createOrCaptureError = (
      options: Parameters<typeof createResponseCacheRuntime>[0]
    ): Error | undefined => {
      try {
        runtimes.push(createResponseCacheRuntime(options, 1_000));
        return undefined;
      } catch (error) {
        return error instanceof Error ? error : new Error(String(error));
      }
    };

    const results = [
      createOrCaptureError({ mode: "redis", url: "redis://localhost:6379" }),
      createOrCaptureError({ mode: "redis" }),
    ];

    for (const error of results) {
      if (error) {
        expect(error.message).toContain("ioredis");
      }
    }

    await Promise.all(runtimes.map((runtime) => runtime.close()));
  });

  it("creates multi-level runtime and clears by namespace tag instead of clearing redis", async () => {
    const client = new FakeRedis();
    const runtime = createResponseCacheRuntime(
      {
        mode: "multi-level",
        memory: { maxEntries: 5, enableStats: true },
        redis: {
          client,
          metaKeyPrefix: "rck:multi",
          scanCount: 10,
          deleteCommand: "del",
        },
        writePolicy: "both",
        backfillOnRemoteHit: false,
        remoteTimeout: 25,
        remoteInvalidationErrors: "throw",
        lease: { enabled: false },
        distributed: false,
      },
      1_000
    );
    const namespace = createResponseCacheNamespaceTag("multi");

    await setResponseSnapshot(
      runtime.cache,
      "multi-key",
      snapshot("multi"),
      1_000,
      ["products"],
      namespace
    );
    expect(await client.get("multi-key")).not.toBeNull();

    await clearResponseCacheRuntime(runtime, namespace);

    expect(await runtime.cache.get("multi-key")).toBeUndefined();
    expect(await client.get("multi-key")).toBeNull();
    await runtime.close();
  });

  it("creates multi-level runtime with redis lease enabled", async () => {
    const client = new FakeRedis();
    const runtime = createResponseCacheRuntime(
      {
        mode: "multi-level",
        redis: { client },
        lease: true,
      },
      1_000
    );

    expect(runtime.lease).toEqual({ onTimeout: "fetch" });
    const lease = await runtime.leaseStore?.acquireLease("multi-hot", 25);
    expect(lease).toBeTruthy();
    await lease?.release();
    await runtime.close();
  });
});

describe("response cache redis lease coordination", () => {
  it("dedupes same-key misses across cache instances with redis lease", async () => {
    const client = new FakeRedis();
    client.throwOnRelease = true;
    const cacheA = createResponseCache({
      ttl: 1_000,
      cacheHub: {
        mode: "redis",
        client,
        lease: { ttl: 100, waitForOwner: 250, pollInterval: 1 },
      },
    });
    const cacheB = createResponseCache({
      ttl: 1_000,
      cacheHub: {
        mode: "redis",
        client,
        lease: true,
      },
    });
    const origin = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { status: 200, body: { value: "shared" } };
    });

    const results = await Promise.all([
      cacheA.handle({ method: "GET", url: "/hot" }, origin),
      cacheB.handle({ method: "GET", url: "/hot" }, origin),
    ]);

    expect(origin).toHaveBeenCalledTimes(1);
    expect(results.map((result) => result.metadata.state).sort()).toEqual([
      "deduped",
      "miss",
    ]);
    expect(results.every((result) => result.metadata.stored === true)).toBe(true);
    await cacheA.close?.();
    await cacheB.close?.();
  });

  it("falls back to origin fetch when lease wait times out and onTimeout is fetch", async () => {
    const client = new FakeRedis();
    client.blockLeases = true;
    const cache = createResponseCache({
      ttl: 1_000,
      cacheHub: {
        mode: "redis",
        client,
        lease: { waitForOwner: 5, pollInterval: 1 },
      },
    });
    const origin = vi.fn(async () => ({ status: 200, body: "fallback" }));

    const result = await cache.handle({ method: "GET", url: "/fallback" }, origin);

    expect(result.metadata.state).toBe("miss");
    expect(result.body).toBe("fallback");
    expect(origin).toHaveBeenCalledTimes(1);
    await cache.close?.();
  });

  it("throws when lease wait times out and onTimeout is throw", async () => {
    const client = new FakeRedis();
    client.blockLeases = true;
    const cache = createResponseCache({
      ttl: 1_000,
      cacheHub: {
        mode: "redis",
        client,
        lease: { waitForOwner: 5, pollInterval: 1, onTimeout: "throw" },
      },
    });
    const origin = vi.fn(async () => ({ status: 200, body: "nope" }));

    await expect(
      cache.handle({ method: "GET", url: "/throw" }, origin)
    ).rejects.toThrow("lease wait timed out");
    expect(origin).not.toHaveBeenCalled();
    await cache.close?.();
  });

  it("retries lease ownership after a short contention window", async () => {
    const client = new FakeRedis();
    client.leaseAcquireFailures = 1;
    client.throwOnRelease = true;
    const cache = createResponseCache({
      ttl: 1_000,
      cacheHub: {
        mode: "redis",
        client,
        lease: { waitForOwner: 5, pollInterval: 1 },
      },
    });
    const origin = vi.fn(async () => ({ status: 200, body: "retry-owner" }));

    const result = await cache.handle({ method: "GET", url: "/retry" }, origin);

    expect(result.metadata.state).toBe("miss");
    expect(result.body).toBe("retry-owner");
    expect(origin).toHaveBeenCalledTimes(1);
    await cache.close?.();
  });

  it("does not emit Cache-Control for response misses that were not stored", async () => {
    const cache = createResponseCache({ ttl: 1_000 });
    const result = await cache.handle(
      { method: "GET", url: "/private" },
      async () => ({
        status: 200,
        headers: { "cache-control": "private" },
        body: "private",
      })
    );

    expect(createResponseCacheWritePayload(result, { cacheControl: true })).toEqual({
      status: 200,
      headers: {
        "cache-control": "private",
        "X-Cache": "MISS",
      },
      body: "private",
    });
    await cache.close?.();
  });
});
