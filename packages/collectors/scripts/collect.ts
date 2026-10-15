/**
 * Collects every feed and writes snapshots to apps/web/public/data/.
 * Runs in CI (GitHub Actions) only; MOENV_API_KEY is passed to this step alone.
 */
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { currentStatus, dataAgeMinutes, FEEDS, type FeedId } from "@taiwan-life-data/contract";
import { createJsonFetcher, parseFeedEnvelope } from "../src/index";
import { collectAny } from "../src/server";

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../apps/web/public/data");
const FEED_IDS = Object.keys(FEEDS) as FeedId[];

const writeAtomic = async (path: string, content: string) => {
  await writeFile(`${path}.tmp`, content);
  await rename(`${path}.tmp`, path);
};

const main = async () => {
  await mkdir(OUT_DIR, { recursive: true });
  const apiKey = process.env.MOENV_API_KEY;
  const summary = [];
  for (const feed of FEED_IDS) {
    const envelope = await collectAny(feed, {
      fetchJson: createJsonFetcher(FEEDS[feed].source.datasetId, 45_000),
      now: Date.now,
      moenvApiKey: apiKey,
    });
    const json = JSON.stringify(envelope);
    if (apiKey && json.includes(apiKey)) throw new Error("公開快照安全檢查未通過");
    parseFeedEnvelope(feed, envelope);
    await writeAtomic(join(OUT_DIR, `${feed}.json`), json);
    const now = Date.now();
    summary.push({ feed, status: currentStatus(envelope, now), sourceTime: envelope.sourceTime, retrievedAt: envelope.retrievedAt, ageMinutes: dataAgeMinutes(FEEDS[feed].freshness, envelope, now), issues: envelope.issues });
    console.log(`${feed.padEnd(8)} ${envelope.status.padEnd(11)} source=${envelope.sourceTime ?? "-"} bytes=${json.length}${envelope.issues.length ? ` issues=${envelope.issues.join("; ")}` : ""}`);
  }
  await writeAtomic(join(OUT_DIR, "index.json"), JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), feeds: summary }));
  if (summary.every((s) => s.status === "unavailable")) {
    console.error("所有資料來源都無法取得。");
    process.exitCode = 1;
  }
};

await main();
