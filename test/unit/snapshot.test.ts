import { describe, expect, it } from "vitest";
import {
  createResponseSnapshot,
  filterCacheableHeaders,
  restoreSnapshot,
} from "../../src/index.js";

describe("snapshot", () => {
  it("filters hop-by-hop headers", () => {
    expect(
      filterCacheableHeaders({
        connection: "keep-alive",
        "content-type": "application/json",
        "transfer-encoding": "chunked",
      })
    ).toEqual({
      "content-type": "application/json",
    });
  });

  it("creates and restores response snapshots", () => {
    const snapshot = createResponseSnapshot(
      {
        status: 200,
        headers: { "content-type": "application/json" },
        body: { ok: true },
      },
      { now: 100, ttl: 2_000 }
    );

    expect(restoreSnapshot(snapshot, { state: "hit", key: "k" }, 250)).toEqual({
      status: 200,
      headers: { "content-type": "application/json" },
      body: { ok: true },
      metadata: {
        state: "hit",
        key: "k",
        age: 150,
        ttl: 2_000,
      },
    });
  });
});
