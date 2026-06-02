import type { HeaderBag, HeadersLike, HeaderValue } from "./types.js";

export function normalizeHeaders(headers?: HeadersLike): HeaderBag {
  const normalized: HeaderBag = {};
  if (!headers) {
    return normalized;
  }

  const maybeHeaders = headers as {
    forEach?: (callback: (value: string, key: string) => void) => void;
    [Symbol.iterator]?: () => Iterator<readonly [string, HeaderValue]>;
  };

  if (typeof maybeHeaders.forEach === "function") {
    maybeHeaders.forEach((value, key) => {
      setHeader(normalized, key, value);
    });
    return normalized;
  }

  if (typeof maybeHeaders[Symbol.iterator] === "function") {
    for (const [key, value] of headers as Iterable<readonly [string, HeaderValue]>) {
      setHeader(normalized, key, value);
    }
    return normalized;
  }

  for (const [key, value] of Object.entries(headers as Record<string, HeaderValue>)) {
    setHeader(normalized, key, value);
  }

  return normalized;
}

export function getHeader(headers: HeaderBag, name: string): string | undefined {
  return headers[name.toLowerCase()];
}

export function hasHeaderToken(
  headers: HeaderBag,
  name: string,
  token: string
): boolean {
  const value = getHeader(headers, name);
  if (!value) {
    return false;
  }
  const expected = token.toLowerCase();
  return value
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .includes(expected);
}

function setHeader(target: HeaderBag, key: string, value: HeaderValue): void {
  if (!key || value === undefined || value === null) {
    return;
  }

  const name = key.toLowerCase();
  const text = Array.isArray(value) ? value.join(", ") : String(value);
  if (!text) {
    return;
  }

  const existing = target[name];
  target[name] = existing ? `${existing}, ${text}` : text;
}
