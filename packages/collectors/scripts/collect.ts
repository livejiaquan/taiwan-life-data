/**
 * Collects every feed and writes snapshots + status.json to apps/web/public/data/.
 * Runs in CI (GitHub Actions) only; MOENV_API_KEY is passed to this step alone.
 *
 * No database: the previously published status.json and snapshots are read back
 * from the live site (PUBLIC_SITE_URL), so history accumulates across deploys and
 * a failed read keeps serving the last good snapshot (re-graded by age on display).
 */
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { currentStatus, dataAgeMinutes, FEEDS, isStatusDoc, updateStatus, type FeedEnvelope, type FeedId, type RunResult, type StatusDoc } from "@taiwan-life-data/contract";
import { createJsonFetcher, parseFeedEnvelope } from "../src/index";
import { collectAny } from "../src/server";

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../apps/web/public/data");
const SITE = (process.env.PUBLIC_SITE_URL ?? "https://livejiaquan.github.io/taiwan-life-data/").replace(/\/?$/, "/");
const FEED_IDS = Object.keys(FEEDS) as FeedId[];
const FAILED_NOTE = "最近一次收集失敗";

const writeAtomic = async (path: string, content: string) => {
  await writeFile(`${path}.tmp`, content);
  await rename(`${path}.tmp`, path);
};

const readPublished = async (path: string): Promise<unknown> => {
  try {
    return await createJsonFetcher(`published ${path}`, 20_000)(`${SITE}data/${path}`);
  } catch {
    return undefined;
  }
};

const main = async () => {
  await mkdir(OUT_DIR, { recursive: true });
  const apiKey = process.env.MOENV_API_KEY;
  const previous = await readPublished("status.json");
  const prevStatus: StatusDoc | null = isStatusDoc(previous) ? previous : null;
  if (!prevStatus) console.log("status: no previous status.json on the live site; history starts now");

  const results: RunResult[] = [];
  for (const feed of FEED_IDS) {
    const fresh = await collectAny(feed, { fetchJson: createJsonFetcher(FEEDS[feed].source.datasetId, 45_000), now: Date.now, moenvApiKey: apiKey });
    let envelope: FeedEnvelope<unknown> = fresh;
    const attemptOk = fresh.data !== null;
    if (!attemptOk) {
      // Keep the last good snapshot rather than replacing it with nothing.
      try {
        const last = parseFeedEnvelope(feed, await readPublished(`${feed}.json`));
        if (last.data !== null) {
          envelope = { ...last, via: "snapshot", issues: [...last.issues.filter((i) => !i.startsWith(FAILED_NOTE)), `${FAILED_NOTE}（${fresh.issues.join("；")}），顯示上一份資料`] };
        }
      } catch {
        // No usable previous snapshot: publish the unavailable envelope.
      }
    }
    const json = JSON.stringify(envelope);
    if (apiKey && json.includes(apiKey)) throw new Error("公開快照安全檢查未通過");
    parseFeedEnvelope(feed, envelope);
    await writeAtomic(join(OUT_DIR, `${feed}.json`), json);
    const now = Date.now();
    const status = currentStatus(envelope, now);
    const ageMinutes = dataAgeMinutes(FEEDS[feed].freshness, envelope, now);
    results.push({ feed, attemptOk, error: attemptOk ? null : fresh.issues.join("；") || "讀取或驗證失敗", status, sourceTime: envelope.sourceTime, ageMinutes });
    console.log(`${feed.padEnd(8)} ${status.padEnd(11)} ok=${attemptOk} source=${envelope.sourceTime ?? "-"} age=${ageMinutes ?? "-"}m bytes=${json.length}${envelope.issues.length ? ` issues=${envelope.issues.join("; ")}` : ""}`);
  }

  const doc = updateStatus(prevStatus, new Date().toISOString(), results);
  const statusJson = JSON.stringify(doc);
  if (apiKey && statusJson.includes(apiKey)) throw new Error("公開狀態檔安全檢查未通過");
  await writeAtomic(join(OUT_DIR, "status.json"), statusJson);
  await writeAtomic(
    join(OUT_DIR, "index.json"),
    JSON.stringify({ schemaVersion: 1, generatedAt: doc.generatedAt, feeds: results.map(({ feed, status, sourceTime, ageMinutes }) => ({ feed, status, sourceTime, ageMinutes })) }),
  );
  console.log(`status: ${doc.runs.length} runs, ${doc.incidents.filter((i) => !i.endedAt).length} open incidents`);
  if (results.every((r) => !r.attemptOk)) {
    console.error("所有資料來源都無法取得。");
    process.exitCode = 1;
  }
};

await main();
