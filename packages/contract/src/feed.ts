import { parseOfficialTime } from "./time";

export const FEED_STATUSES = ["live", "delayed", "stale", "unavailable"] as const;
export type FeedStatus = (typeof FEED_STATUSES)[number];

export type FeedId = "warnings" | "uv" | "heat" | "aqi";

export interface FeedSource {
  /** Agency, e.g. 交通部中央氣象署 */
  agency: string;
  /** Official dataset title. */
  title: string;
  /** Dataset id at the agency (e.g. W-C0033-001). */
  datasetId: string;
  /** Human-facing page for the dataset (never a key-bearing URL). */
  url: string;
  license: string;
}

export interface FreshnessPolicy {
  /**
   * What "age" means for this feed.
   * - sourceTime: age of the newest official timestamp (observations, forecasts).
   * - retrievedAt: the file only changes when something happens (warnings), so a
   *   recent successful read is what makes it current.
   */
  basis: "sourceTime" | "retrievedAt";
  /** Up to this age the feed is "live". */
  liveForMinutes: number;
  /** Up to this age the feed is "delayed"; beyond it is "stale". */
  delayedForMinutes: number;
  /** Human description of the official update cadence. */
  cadence: string;
}

export interface FeedDefinition {
  id: FeedId;
  label: string;
  source: FeedSource;
  freshness: FreshnessPolicy;
}

const CWA_LICENSE = "政府資料開放授權條款－第1版";
const MOENV_LICENSE = "政府資料開放授權條款－第1版";

export const FEEDS: Record<FeedId, FeedDefinition> = {
  warnings: {
    id: "warnings",
    label: "天氣警特報",
    source: {
      agency: "交通部中央氣象署",
      title: "天氣特報-各別縣市地區目前之天氣警特報情形",
      datasetId: "W-C0033-001",
      url: "https://data.gov.tw/dataset/9244",
      license: CWA_LICENSE,
    },
    freshness: { basis: "retrievedAt", liveForMinutes: 15, delayedForMinutes: 60, cadence: "有發布或解除時更新" },
  },
  uv: {
    id: "uv",
    label: "紫外線與氣溫觀測",
    source: {
      agency: "交通部中央氣象署",
      title: "現在天氣觀測報告（氣象站，含紫外線指數）",
      datasetId: "O-A0003-001",
      url: "https://data.gov.tw/dataset/9178",
      license: CWA_LICENSE,
    },
    freshness: { basis: "sourceTime", liveForMinutes: 40, delayedForMinutes: 120, cadence: "每 10 分鐘（紫外線每小時）" },
  },
  heat: {
    id: "heat",
    label: "熱傷害指數",
    source: {
      agency: "交通部中央氣象署",
      title: "健康氣象－熱傷害指數及警示全台各鄉鎮五日逐三小時預報",
      datasetId: "M-A0085-001",
      url: "https://data.gov.tw/dataset/143330",
      license: CWA_LICENSE,
    },
    freshness: { basis: "sourceTime", liveForMinutes: 7 * 60, delayedForMinutes: 13 * 60, cadence: "每 6 小時" },
  },
  aqi: {
    id: "aqi",
    label: "空氣品質指標",
    source: {
      agency: "環境部",
      title: "空氣品質指標(AQI)",
      datasetId: "AQX_P_432",
      url: "https://data.gov.tw/dataset/40448",
      license: MOENV_LICENSE,
    },
    freshness: { basis: "sourceTime", liveForMinutes: 80, delayedForMinutes: 180, cadence: "每小時" },
  },
};

/** One snapshot of one feed. Every published JSON file under /data follows this shape. */
export interface FeedEnvelope<T> {
  schemaVersion: 1;
  feed: FeedId;
  /** Newest official timestamp in the data (ISO 8601), null when unknown. */
  sourceTime: string | null;
  /** When this envelope was read from the official source (ISO 8601). */
  retrievedAt: string;
  /** Status at retrievedAt. Consumers must recompute with `currentStatus` — never trust a stored "live". */
  status: FeedStatus;
  /** How this envelope was obtained. */
  via: "snapshot" | "browser";
  source: FeedSource;
  /** Non-fatal problems (dropped rows etc.). Never contains URLs or credentials. */
  issues: string[];
  /** Null exactly when status is "unavailable". */
  data: T | null;
}

const MINUTE = 60_000;

/**
 * Fail-closed status: anything missing, unparseable or from the future beyond
 * tolerance is never reported as live.
 */
export const computeStatus = (
  policy: FreshnessPolicy,
  times: { sourceTime: string | null; retrievedAt: string },
  hasData: boolean,
  now: number,
): FeedStatus => {
  if (!hasData) return "unavailable";
  const raw = policy.basis === "sourceTime" ? times.sourceTime : times.retrievedAt;
  const at = parseOfficialTime(raw ?? undefined);
  if (at === undefined) return "stale";
  const ageMinutes = (now - at) / MINUTE;
  if (ageMinutes < -15) return "stale";
  if (ageMinutes <= policy.liveForMinutes) return "live";
  if (ageMinutes <= policy.delayedForMinutes) return "delayed";
  return "stale";
};

/** Age of the data in whole minutes (by the feed's freshness basis), or null. */
export const dataAgeMinutes = (
  policy: FreshnessPolicy,
  times: { sourceTime: string | null; retrievedAt: string },
  now: number,
): number | null => {
  const at = parseOfficialTime((policy.basis === "sourceTime" ? times.sourceTime : times.retrievedAt) ?? undefined);
  return at === undefined ? null : Math.max(0, Math.round((now - at) / MINUTE));
};

export const createEnvelope = <T>(
  feed: FeedId,
  input: { sourceTime: string | null; data: T | null; issues?: string[]; via?: FeedEnvelope<T>["via"] },
  now: number,
): FeedEnvelope<T> => {
  const retrievedAt = new Date(now).toISOString();
  const definition = FEEDS[feed];
  return {
    schemaVersion: 1,
    feed,
    sourceTime: input.sourceTime,
    retrievedAt,
    status: computeStatus(definition.freshness, { sourceTime: input.sourceTime, retrievedAt }, input.data !== null, now),
    via: input.via ?? "snapshot",
    source: definition.source,
    issues: input.issues ?? [],
    data: input.data,
  };
};

/** Re-evaluates an envelope at `now` (e.g. a snapshot opened hours after it was made). */
export const currentStatus = <T>(envelope: FeedEnvelope<T>, now: number): FeedStatus =>
  computeStatus(FEEDS[envelope.feed].freshness, envelope, envelope.data !== null, now);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isIsoOrNull = (value: unknown) =>
  value === null || (typeof value === "string" && /(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value)));

const CREDENTIAL_PATTERN = /api[_-]?key=|Authorization=|CWA-[0-9a-f]{8}-/i;

/**
 * Structural validation of an envelope read from disk or network.
 * `validateData` checks the feed-specific payload. Throws on any violation.
 */
export const parseEnvelope = <T>(
  input: unknown,
  feed: FeedId,
  validateData: (data: unknown) => data is T,
): FeedEnvelope<T> => {
  if (!isRecord(input)) throw new Error(`${feed}: envelope is not an object`);
  const problems: string[] = [];
  if (input.schemaVersion !== 1) problems.push("schemaVersion");
  if (input.feed !== feed) problems.push("feed");
  if (!isIsoOrNull(input.sourceTime)) problems.push("sourceTime");
  if (typeof input.retrievedAt !== "string" || !isIsoOrNull(input.retrievedAt)) problems.push("retrievedAt");
  if (!FEED_STATUSES.includes(input.status as FeedStatus)) problems.push("status");
  if (input.via !== "snapshot" && input.via !== "browser") problems.push("via");
  if (!isRecord(input.source) || input.source.datasetId !== FEEDS[feed].source.datasetId) problems.push("source");
  if (!Array.isArray(input.issues) || !input.issues.every((i) => typeof i === "string")) problems.push("issues");
  if (input.data === null) {
    if (input.status !== "unavailable") problems.push("data null but status is not unavailable");
  } else if (!validateData(input.data)) problems.push("data");
  if (input.status === "unavailable" && input.data !== null) problems.push("unavailable envelope carries data");
  if (CREDENTIAL_PATTERN.test(JSON.stringify(input))) problems.push("credential marker");
  if (problems.length) throw new Error(`${feed}: invalid envelope (${problems.join(", ")})`);
  return input as unknown as FeedEnvelope<T>;
};
