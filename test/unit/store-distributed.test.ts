import { afterEach, describe, expect, it, vi } from "vitest";

describe("response cache distributed invalidation runtime", () => {
  afterEach(() => {
    vi.doUnmock("cache-hub/distributed");
    vi.resetModules();
  });

  it("creates and closes distributed invalidator from explicit redis config", async () => {
    vi.resetModules();
    const instances: FakeDistributedCacheInvalidator[] = [];
    vi.doMock("cache-hub/distributed", () => ({
      DistributedCacheInvalidator: class extends FakeDistributedCacheInvalidator {
        constructor(options: Record<string, unknown>) {
          super(options);
          instances.push(this);
        }
      },
    }));

    const { createResponseCacheRuntime, invalidateResponseCacheTag } = await import(
      "../../src/store.js"
    );
    const redis = { id: "redis" };
    const runtime = createResponseCacheRuntime(
      {
        mode: "redis",
        client: {},
        distributed: {
          redisUrl: "redis://example.test:6379",
          redis,
          channel: "response-cache:test",
          instanceId: "instance-a",
        },
      },
      1_000
    );

    expect(instances).toHaveLength(1);
    expect(instances[0]?.options).toMatchObject({
      redisUrl: "redis://example.test:6379",
      redis,
      channel: "response-cache:test",
      instanceId: "instance-a",
    });

    await invalidateResponseCacheTag(runtime, "products");
    await runtime.close();

    expect(instances[0]?.invalidateTag).toHaveBeenCalledWith("products");
    expect(instances[0]?.close).toHaveBeenCalledTimes(1);
  });

  it("supports shorthand distributed config and disabled distributed config", async () => {
    vi.resetModules();
    const instances: FakeDistributedCacheInvalidator[] = [];
    vi.doMock("cache-hub/distributed", () => ({
      DistributedCacheInvalidator: class extends FakeDistributedCacheInvalidator {
        constructor(options: Record<string, unknown>) {
          super(options);
          instances.push(this);
        }
      },
    }));

    const { createResponseCacheRuntime } = await import("../../src/store.js");
    const shorthand = createResponseCacheRuntime(
      {
        mode: "multi-level",
        redis: { client: {} },
        distributed: true,
      },
      1_000
    );
    const disabled = createResponseCacheRuntime(
      {
        mode: "redis",
        client: {},
        distributed: { enabled: false },
      },
      1_000
    );

    expect(shorthand.distributed).toBe(instances[0]);
    expect(instances[0]?.options).not.toHaveProperty("redisUrl");
    expect(disabled.distributed).toBeUndefined();
    await shorthand.close();
    await disabled.close();
  });
});

class FakeDistributedCacheInvalidator {
  readonly invalidateTag = vi.fn(async () => {});
  readonly close = vi.fn(async () => {});

  constructor(readonly options: Record<string, unknown>) {}
}
