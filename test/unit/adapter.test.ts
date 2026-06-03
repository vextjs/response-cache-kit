import { describe, expect, it } from "vitest";
import {
  createResponseCacheCapture,
  createResponseCacheWritePayload,
  normalizeResponseCacheRequest,
} from "../../src/index.js";
import type { ResponseCacheResult } from "../../src/index.js";

describe("adapter helpers", () => {
  it("normalizes framework request inputs", () => {
    expect(
      normalizeResponseCacheRequest({
        method: "get",
        url: new URL("https://example.com/products?b=2&a=1"),
        headers: { accept: "application/json" },
        partitionKey: "tenant:1",
      })
    ).toEqual({
      method: "get",
      url: "https://example.com/products?b=2&a=1",
      headers: { accept: "application/json" },
      partitionKey: "tenant:1",
    });

    expect(normalizeResponseCacheRequest({ partitionKey: null })).toEqual({
      url: "/",
    });
  });

  it("creates write payloads with cache headers", () => {
    const result: ResponseCacheResult = {
      status: 200,
      headers: { "content-type": "application/json" },
      body: { ok: true },
      metadata: { state: "miss", ttl: 1_000, age: 0, stored: true },
    };

    expect(
      createResponseCacheWritePayload(result, { cacheControl: true })
    ).toEqual({
      status: 200,
      headers: {
        "content-type": "application/json",
        "X-Cache": "MISS",
        "Cache-Control": "public,max-age=1",
      },
      body: { ok: true },
    });
  });

  it("captures framework responses for cache write-back", () => {
    const capture = createResponseCacheCapture({
      headers: { "x-start": "1" },
    });

    capture.setStatus(201);
    capture.setHeader("Content-Type", "application/json");
    capture.setBody({ created: true });

    expect(capture.toOriginResponse()).toEqual({
      status: 201,
      headers: {
        "x-start": "1",
        "content-type": "application/json",
      },
      body: { created: true },
    });
  });

  it("keeps status omitted when a capture never sets it", () => {
    const capture = createResponseCacheCapture();
    capture.setBody("ok");

    expect(capture.toOriginResponse()).toEqual({
      headers: {},
      body: "ok",
    });
  });
});
