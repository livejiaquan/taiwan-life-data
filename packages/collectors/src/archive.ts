/**
 * History archive (docs/DECISIONS.md D21, format in docs/API.md).
 *
 * One file per feed per Taipei calendar day: archive/v1/<feed>/<YYYY-MM-DD>.json, holding a
 * compact sample per distinct official update. Pure functions only; scripts/archive.ts does I/O.
 */
import { FEEDS, parseOfficialTime, type FeedEnvelope, type FeedId, type FeedSource, type FeedStatus } from "@taiwan-life-data/contract";
import type { FeedDataMap } from "./collect";

export const ARCHIVE_RETENTION_DAYS = 90;

/** Column-oriented table: keeps per-day files small while staying self-describing. */
export interface Table {
  columns: string[];
  rows: Array<Array<string | number | null>>;
}

export interface ArchiveSample {
  retrievedAt: string;
  sourceTime: string | null;
  /** Status at collect time. */
  status: FeedStatus;
  data: unknown;
}

export interface ArchiveDay {
  schemaVersion: 1;
  feed: FeedId;
  /** Taipei calendar date of the samples' official time. */
  date: string;
  source: FeedSource;
  /** Describes `data` in each sample. */
  format: string;
  samples: ArchiveSample[];
}

export interface ArchiveIndex {
  schemaVersion: 1;
  updatedAt: string;
  retentionDays: number;
  feeds: Partial<Record<FeedId, { dates: string[]; format: string }>>;
}

/** Forecast feeds: a shared time axis plus one value array per township. */
const forecastTable = (times: string[], towns: Array<{ geocode: string; values: Map<string, number | null> }>): Table => ({
  columns: ["geocode", ...times],
  rows: towns.map((t) => [t.geocode, ...times.map((time) => t.values.get(time) ?? null)]),
});

export const ARCHIVE_FORMATS: Record<FeedId, string> = {
  warnings: "WarningsData（與 data/warnings.json 的 data 相同）",
  uv: "Table：只含有紫外線讀值的測站",
  heat: "{ issuedAt, table }：table 每列為一個鄉鎮，欄位為 geocode 與各 3 小時時段起點的熱傷害指數",
  aqi: "Table：每列為一個測站",
  rain: "{ issuedAt, table }：table 每列為一個鄉鎮，欄位為 geocode 與各 3 小時時段起點的降雨機率（%）",
  power: "PowerData（與 data/power.json 的 data 相同）",
  reservoir: "Table：每列為一座水庫",
};

/** Reduces a snapshot's data to what is worth keeping for 90 days. */
export const compactData = <K extends FeedId>(feed: K, data: FeedDataMap[K]): unknown => {
  switch (feed) {
    case "warnings":
    case "power":
      return data;
    case "uv": {
      const d = data as FeedDataMap["uv"];
      return {
        columns: ["id", "name", "county", "townCode", "observedAt", "uvIndex", "temperature"],
        rows: d.stations.filter((s) => s.uvIndex !== null).map((s) => [s.id, s.name, s.county, s.townCode ?? null, s.observedAt, s.uvIndex, s.temperature]),
      } satisfies Table;
    }
    case "aqi": {
      const d = data as FeedDataMap["aqi"];
      return {
        columns: ["siteId", "name", "county", "publishTime", "aqi", "status", "pollutant", "pm25", "pm10", "o3_8hr"],
        rows: d.stations.map((s) => [s.siteId, s.name, s.county, s.publishTime, s.aqi, s.status, s.pollutant, s.pm25, s.pm10, s.o3_8hr]),
      } satisfies Table;
    }
    case "heat": {
      const d = data as FeedDataMap["heat"];
      const times = [...new Set(d.towns.flatMap((t) => t.points.map((p) => p.time)))].sort();
      return { issuedAt: d.issuedAt, table: forecastTable(times, d.towns.map((t) => ({ geocode: t.geocode, values: new Map(t.points.map((p) => [p.time, p.index])) }))) };
    }
    case "rain": {
      const d = data as FeedDataMap["rain"];
      const times = [...new Set(d.towns.flatMap((t) => t.slots.map((s) => s.start)))].sort();
      return { issuedAt: d.issuedAt, table: forecastTable(times, d.towns.map((t) => ({ geocode: t.geocode, values: new Map(t.slots.map((s) => [s.start, s.pop])) }))) };
    }
    case "reservoir": {
      const d = data as FeedDataMap["reservoir"];
      return {
        columns: ["id", "name", "observedAt", "percent", "storage", "capacity"],
        rows: d.reservoirs.map((r) => [r.id, r.name, r.observedAt, r.percent, r.storage, r.capacity]),
      } satisfies Table;
    }
    default:
      throw new Error(`no archive format for ${String(feed)}`);
  }
};

/** YYYY-MM-DD in Asia/Taipei (UTC+8, no DST). */
export const taipeiDate = (ms: number): string => new Date(ms + 8 * 3_600_000).toISOString().slice(0, 10);

/**
 * Which day file a snapshot belongs to, or null when it should not be archived
 * (no data, or no usable time). Warnings are filed by retrievedAt: the official file
 * keeps an old `sent` time while nothing changes.
 */
export const archiveDateOf = (envelope: FeedEnvelope<unknown>): string | null => {
  if (envelope.data === null) return null;
  const basis = FEEDS[envelope.feed].freshness.basis === "retrievedAt" ? envelope.retrievedAt : envelope.sourceTime;
  const at = parseOfficialTime(basis ?? undefined);
  return at === undefined ? null : taipeiDate(at);
};

const sameUpdate = (feed: FeedId, a: ArchiveSample, b: ArchiveSample) =>
  FEEDS[feed].freshness.basis === "retrievedAt" ? JSON.stringify(a.data) === JSON.stringify(b.data) : a.sourceTime === b.sourceTime;

/**
 * Adds a snapshot to its day file. A sample is skipped when the day already holds the same
 * official update (same sourceTime; for warnings, identical content to the last sample),
 * so re-published snapshots after a failed collect never duplicate.
 */
export const appendSample = <K extends FeedId>(
  day: ArchiveDay | null,
  envelope: FeedEnvelope<FeedDataMap[K]>,
): { day: ArchiveDay; added: boolean } | null => {
  const date = archiveDateOf(envelope);
  if (date === null || envelope.data === null) return null;
  if (day && (day.feed !== envelope.feed || day.date !== date)) throw new Error(`archive: ${envelope.feed} ${date} written to ${day.feed} ${day.date}`);
  const sample: ArchiveSample = { retrievedAt: envelope.retrievedAt, sourceTime: envelope.sourceTime, status: envelope.status, data: compactData(envelope.feed as K, envelope.data) };
  const base: ArchiveDay = day ?? { schemaVersion: 1, feed: envelope.feed, date, source: envelope.source, format: ARCHIVE_FORMATS[envelope.feed], samples: [] };
  const isWarnings = FEEDS[envelope.feed].freshness.basis === "retrievedAt";
  const duplicate = isWarnings ? base.samples.length > 0 && sameUpdate(envelope.feed, base.samples.at(-1)!, sample) : base.samples.some((s) => sameUpdate(envelope.feed, s, sample));
  if (duplicate) return { day: base, added: false };
  const samples = [...base.samples, sample].sort((a, b) => (a.sourceTime ?? a.retrievedAt).localeCompare(b.sourceTime ?? b.retrievedAt));
  return { day: { ...base, samples }, added: true };
};

/** Dates to keep: the most recent `retentionDays` Taipei calendar days up to `today`. Future-dated files are kept. */
export const splitRetention = (dates: string[], today: string, retentionDays = ARCHIVE_RETENTION_DAYS): { keep: string[]; drop: string[] } => {
  const cutoff = taipeiDate(Date.parse(`${today}T12:00:00+08:00`) - (retentionDays - 1) * 86_400_000);
  const sorted = [...new Set(dates)].sort();
  return { keep: sorted.filter((d) => d >= cutoff), drop: sorted.filter((d) => d < cutoff) };
};

export const isArchiveDay = (value: unknown, feed: FeedId, date: string): value is ArchiveDay => {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Partial<ArchiveDay>;
  return v.schemaVersion === 1 && v.feed === feed && v.date === date && Array.isArray(v.samples);
};
