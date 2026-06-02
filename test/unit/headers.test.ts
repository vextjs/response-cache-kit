import { describe, expect, it } from "vitest";
import {
  getHeader,
  hasHeaderToken,
  normalizeHeaders,
} from "../../src/headers.js";

describe("headers", () => {
  it("normalizes missing headers", () => {
    expect(normalizeHeaders()).toEqual({});
  });

  it("normalizes Headers-like forEach input", () => {
    const headers = new Headers();
    headers.append("accept", "application/json");
    headers.append("accept", "text/plain");

    expect(normalizeHeaders(headers)).toEqual({
      accept: "application/json, text/plain",
    });
  });

  it("normalizes iterable header entries", () => {
    const iterableHeaders = {
      *[Symbol.iterator](): Iterator<readonly [string, string[] | boolean]> {
        yield ["x-array", ["a", "b"]];
        yield ["x-bool", true];
      },
    };

    expect(
      normalizeHeaders(iterableHeaders)
    ).toEqual({
      "x-array": "a, b",
      "x-bool": "true",
    });
  });

  it("combines repeated iterable header entries", () => {
    const iterableHeaders = {
      *[Symbol.iterator](): Iterator<readonly [string, string]> {
        yield ["x-repeat", "a"];
        yield ["x-repeat", "b"];
      },
    };

    expect(normalizeHeaders(iterableHeaders)).toEqual({
      "x-repeat": "a, b",
    });
  });

  it("skips empty names and empty values", () => {
    expect(
      normalizeHeaders({
        "": "ignored",
        empty: "",
        nil: null,
        missing: undefined,
        ok: 1,
      })
    ).toEqual({ ok: "1" });
  });

  it("reads headers case-insensitively and detects tokens", () => {
    const headers = normalizeHeaders({
      "Cache-Control": "max-age=0, no-cache",
    });

    expect(getHeader(headers, "CACHE-CONTROL")).toBe("max-age=0, no-cache");
    expect(hasHeaderToken(headers, "cache-control", "NO-CACHE")).toBe(true);
    expect(hasHeaderToken(headers, "cache-control", "private")).toBe(false);
    expect(hasHeaderToken(headers, "missing", "private")).toBe(false);
  });
});
