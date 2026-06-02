import { request } from "node:http";
import { createServer } from "node:http";
import { performance } from "node:perf_hooks";
import { createResponseCache } from "../dist/esm/index.js";

const cache = createResponseCache({ ttl: 2_000 });
let originCalls = 0;

async function origin() {
  originCalls++;
  await new Promise((resolve) => setTimeout(resolve, 2));
  return {
    status: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ok: true, originCalls }),
  };
}

const server = createServer(async (req, res) => {
  if (!req.url) {
    res.statusCode = 400;
    res.end("missing url");
    return;
  }

  if (req.url.startsWith("/baseline")) {
    const response = await origin();
    res.statusCode = response.status;
    for (const [name, value] of Object.entries(response.headers)) {
      res.setHeader(name, value);
    }
    res.end(response.body);
    return;
  }

  const result = await cache.handle(
    {
      method: req.method,
      url: req.url,
      headers: req.headers,
    },
    origin
  );
  res.statusCode = result.status;
  for (const [name, value] of Object.entries(result.headers)) {
    res.setHeader(name, value);
  }
  res.setHeader("x-response-cache", result.metadata.state);
  res.end(String(result.body));
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (!address || typeof address === "string") {
  throw new Error("unable to bind benchmark server");
}

const baseUrl = `http://127.0.0.1:${address.port}`;

try {
  await runCase("baseline-no-cache", `${baseUrl}/baseline`, 10, 1);
  await cache.handle({ method: "GET", url: "/hot" }, origin);
  await runCase("hot-cache-hit", `${baseUrl}/hot`, 50, 1);
  await new Promise((resolve) => setTimeout(resolve, 2_050));
  const beforeRace = originCalls;
  await runCase("expired-race", `${baseUrl}/hot`, 100, 1);
  console.log(`expired-race origin calls: ${originCalls - beforeRace}`);
} finally {
  await new Promise((resolve) => server.close(resolve));
}

async function runCase(title, url, connections, durationSeconds) {
  const endAt = performance.now() + durationSeconds * 1000;
  const latencies = [];
  let errors = 0;
  let completed = 0;

  async function worker() {
    while (performance.now() < endAt) {
      const start = performance.now();
      try {
        await requestOnce(url);
        latencies.push(performance.now() - start);
        completed++;
      } catch {
        errors++;
      }
    }
  }

  await Promise.all(Array.from({ length: connections }, () => worker()));
  latencies.sort((a, b) => a - b);
  const p95 = percentile(latencies, 0.95);
  const reqPerSecond = Math.round(completed / durationSeconds);
  console.log(
    `${title}: req/sec=${reqPerSecond}, p95~=${p95.toFixed(2)}ms, errors=${errors}`
  );
}

function requestOnce(url) {
  return new Promise((resolve, reject) => {
    const req = request(url, (res) => {
      res.resume();
      res.on("end", resolve);
    });
    req.on("error", reject);
    req.end();
  });
}

function percentile(values, percentileValue) {
  if (values.length === 0) {
    return 0;
  }
  const index = Math.min(
    values.length - 1,
    Math.floor(values.length * percentileValue)
  );
  return values[index] ?? 0;
}
