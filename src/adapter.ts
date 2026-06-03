import { normalizeHeaders } from "./headers.js";
import { createResponseCacheHeaders } from "./cache-headers.js";
import type {
  HeaderBag,
  HeaderValue,
  ResponseCacheAdapterRequestInput,
  ResponseCacheCapture,
  ResponseCacheHeaderOptions,
  ResponseCacheOriginResponse,
  ResponseCacheRequest,
  ResponseCacheResult,
  ResponseCacheWritePayload,
} from "./types.js";

export function normalizeResponseCacheRequest(
  input: ResponseCacheAdapterRequestInput
): ResponseCacheRequest {
  const request: ResponseCacheRequest = {
    url: String(input.url ?? "/"),
  };

  if (input.method) {
    request.method = input.method;
  }
  if (input.headers) {
    request.headers = input.headers;
  }
  if (input.partitionKey) {
    request.partitionKey = input.partitionKey;
  }

  return request;
}

export function createResponseCacheWritePayload(
  result: ResponseCacheResult,
  options: ResponseCacheHeaderOptions = {}
): ResponseCacheWritePayload {
  return {
    status: result.status,
    headers: {
      ...result.headers,
      ...createResponseCacheHeaders(result, options),
    },
    body: result.body,
  };
}

/**
 * Small capture object for adapters that intercept a framework response.
 */
export function createResponseCacheCapture(
  initial: Partial<ResponseCacheOriginResponse> = {}
): ResponseCacheCapture {
  let status = initial.status;
  let headers: HeaderBag = normalizeHeaders(initial.headers);
  let body = initial.body;

  return {
    setStatus(nextStatus) {
      status = nextStatus;
    },
    setHeader(name, value) {
      headers = normalizeHeaders({
        ...headers,
        [name]: value,
      });
    },
    setBody(nextBody) {
      body = nextBody;
    },
    toOriginResponse() {
      const response: ResponseCacheOriginResponse = {
        headers,
        body,
      };
      if (status !== undefined) {
        response.status = status;
      }
      return response;
    },
  };
}
