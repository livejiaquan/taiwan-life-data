/**
 * Reproduces the endpoint measurements in docs/DECISIONS.md:
 * CORS headers (with an Origin), preflight, latency, size, Last-Modified and
 * the age of the newest official timestamp. Usage: npm run probe [-- --runs 5]
 * Prints no URLs that contain keys.
 */
import { CWA_FILES, createJsonFetcher } from "../packages/collectors/src/index";
import { resolveAqiUrl } from "../packages/collectors/src/server";

const ORIGIN = "https://livejiaquan.github.io";
const runs = Number(process.argv[process.argv.indexOf("--runs") + 1]) || 5;

const quantile = (values: number[], q: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
};

const probe = async (label: string, url: string) => {
  const head = await fetch(url, { headers: { Origin: ORIGIN } });
  const acao = head.headers.get("access-control-allow-origin") ?? "none";
  const lastModified = head.headers.get("last-modified") ?? "-";
  await head.arrayBuffer();
  const preflight = await fetch(url, { method: "OPTIONS", headers: { Origin: ORIGIN, "Access-Control-Request-Method": "GET" } });
  const times: number[] = [];
  let bytes = 0;
  for (let i = 0; i < runs; i += 1) {
    const start = performance.now();
    const response = await fetch(url, { headers: { Origin: ORIGIN } });
    bytes = (await response.arrayBuffer()).byteLength;
    times.push(performance.now() - start);
  }
  console.log([label, `ACAO=${acao}`, `OPTIONS=${preflight.status}`, `p50=${quantile(times, 0.5).toFixed(0)}ms`, `max=${Math.max(...times).toFixed(0)}ms`, `bytes=${bytes}`, `Last-Modified=${lastModified}`].join(" | "));
};

console.log(`probe at ${new Date().toISOString()} from ${Intl.DateTimeFormat().resolvedOptions().timeZone}, ${runs} runs each`);
for (const [feed, url] of Object.entries(CWA_FILES)) await probe(feed, url);
const { url } = await resolveAqiUrl(process.env.MOENV_API_KEY, createJsonFetcher("data.gov.tw"));
await probe("aqi (MOENV, key-bearing; never sent to browsers)", url);
