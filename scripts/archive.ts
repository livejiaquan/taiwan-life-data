/**
 * Appends the snapshots just written by `npm run collect` to the history archive.
 *
 *   npm run archive -- <archive-dir>
 *
 * <archive-dir> is a checkout of the repo's `data` branch (CI) — files live under v1/.
 * Afterwards the archive is mirrored into apps/web/public/archive/ so the Pages build
 * serves it, and data/power-profile.json (綠電時段 from the last 14 days) is derived.
 * docs/DECISIONS.md D21; format in docs/API.md.
 */
import { cp, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  appendSample,
  ARCHIVE_FORMATS,
  ARCHIVE_RETENTION_DAYS,
  computeProfile,
  isArchiveDay,
  parseFeedEnvelope,
  splitRetention,
  taipeiDate,
  type ArchiveDay,
  type ArchiveIndex,
  type IntensityPoint,
  type PowerData,
} from "@taiwan-life-data/collectors";
import { FEEDS, type FeedId } from "@taiwan-life-data/contract";

const ROOT = resolve(import.meta.dirname, "..");
const DATA = join(ROOT, "apps/web/public/data");
const MIRROR = join(ROOT, "apps/web/public/archive");
const PROFILE_DAYS = 14;

const dir = process.argv[2];
if (!dir) throw new Error("usage: npm run archive -- <archive-dir>");
const V1 = join(resolve(dir), "v1");

/** undefined only when the file does not exist; an unreadable or corrupt file stops the run (never overwrite history). */
const readJson = async (path: string): Promise<unknown> => {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  return JSON.parse(text);
};

const writeAtomic = async (path: string, value: unknown) => {
  await writeFile(`${path}.tmp`, JSON.stringify(value));
  await rename(`${path}.tmp`, path);
};

const listDates = async (feed: FeedId): Promise<string[]> => {
  try {
    return (await readdir(join(V1, feed))).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).map((f) => f.slice(0, 10));
  } catch {
    return [];
  }
};

const now = Date.now();
const today = taipeiDate(now);
const index: ArchiveIndex = { schemaVersion: 1, updatedAt: new Date(now).toISOString(), retentionDays: ARCHIVE_RETENTION_DAYS, feeds: {} };

for (const feed of Object.keys(FEEDS) as FeedId[]) {
  await mkdir(join(V1, feed), { recursive: true });
  let note = "no snapshot";
  const raw = await readJson(join(DATA, `${feed}.json`));
  if (raw !== undefined) {
    const envelope = parseFeedEnvelope(feed, raw);
    const probe = appendSample(null, envelope);
    if (probe) {
      const path = join(V1, feed, `${probe.day.date}.json`);
      const existing = await readJson(path);
      if (existing !== undefined && !isArchiveDay(existing, feed, probe.day.date)) throw new Error(`archive: ${path} 不是有效的存檔，停止以免覆蓋歷史`);
      const result = appendSample((existing as ArchiveDay | undefined) ?? null, envelope)!;
      if (result.added) await writeAtomic(path, result.day);
      note = `${result.added ? "added" : "duplicate"} → ${probe.day.date} (${result.day.samples.length} samples)`;
    } else note = "no data, skipped";
  }
  const { keep, drop } = splitRetention(await listDates(feed), today);
  for (const date of drop) await rm(join(V1, feed, `${date}.json`));
  index.feeds[feed] = { dates: keep, format: ARCHIVE_FORMATS[feed] };
  console.log(`archive ${feed.padEnd(9)} ${note}; ${keep.length} days kept${drop.length ? `, ${drop.length} pruned` : ""}`);
}
await writeAtomic(join(V1, "index.json"), index);

// 綠電時段 from our own power samples of the last 14 days.
const points: IntensityPoint[] = [];
for (const date of (index.feeds.power?.dates ?? []).slice(-PROFILE_DAYS)) {
  const day = await readJson(join(V1, "power", `${date}.json`));
  if (!isArchiveDay(day, "power", date)) continue;
  for (const s of day.samples) {
    const data = s.data as PowerData;
    const at = Date.parse(data.observedAt);
    if (Number.isFinite(at) && now - at <= PROFILE_DAYS * 86_400_000) points.push({ at, lifecycle: data.intensity.lifecycle });
  }
}
const profile = computeProfile(points, { kind: "recent", basis: `本站存檔：最近 ${PROFILE_DAYS} 天收集到的台電機組資料`, generatedAt: new Date(now).toISOString() });
await mkdir(DATA, { recursive: true });
await writeAtomic(join(DATA, "power-profile.json"), profile);
console.log(`power-profile: ${profile.samples} samples${profile.greenest ? `, greenest ${profile.greenest.startHour}–${profile.greenest.endHour} 時` : `; ${profile.insufficient}`}`);

await rm(MIRROR, { recursive: true, force: true });
await mkdir(MIRROR, { recursive: true });
await cp(V1, join(MIRROR, "v1"), { recursive: true });
console.log(`mirrored archive into apps/web/public/archive/v1`);
