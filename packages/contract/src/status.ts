import { FEEDS, FEED_STATUSES, type FeedId, type FeedStatus } from "./feed";

/**
 * data/status.json — written by every collect run, read by the /status page.
 * There is no database: each run reads the previously published status.json
 * from the live site and appends to it, so history survives redeploys.
 */
export interface FeedHealth {
  /** Status of the published snapshot at collect time. */
  status: FeedStatus;
  sourceTime: string | null;
  /** Data age (minutes, by the feed's freshness basis) at collect time. */
  ageMinutes: number | null;
  lastAttemptAt: string;
  lastAttemptOk: boolean;
  lastSuccessAt: string | null;
  lastError: string | null;
}

export interface RunFeed {
  status: FeedStatus;
  age: number | null;
  ok: boolean;
}

export interface RunRecord {
  at: string;
  feeds: Partial<Record<FeedId, RunFeed>>;
}

export type IncidentKind = "collect-failed" | "stale";

export interface Incident {
  feed: FeedId;
  kind: IncidentKind;
  startedAt: string;
  endedAt: string | null;
  detail: string;
}

export interface StatusDoc {
  schemaVersion: 1;
  generatedAt: string;
  feeds: Partial<Record<FeedId, FeedHealth>>;
  runs: RunRecord[];
  incidents: Incident[];
}

export interface RunResult {
  feed: FeedId;
  attemptOk: boolean;
  error: string | null;
  status: FeedStatus;
  sourceTime: string | null;
  ageMinutes: number | null;
}

export const STATUS_LIMITS = { runs: 300, incidents: 100 };

const problemOf = (r: RunResult): { kind: IncidentKind; detail: string } | null => {
  if (!r.attemptOk) return { kind: "collect-failed", detail: r.error ?? "讀取或驗證失敗" };
  if (r.status === "stale" || r.status === "unavailable") return { kind: "stale", detail: `收集時資料${r.status === "stale" ? "過舊" : "無法取得"}（資料年齡 ${r.ageMinutes ?? "?"} 分鐘）` };
  return null;
};

/** Folds one collect run into the previous status document. Pure. */
export const updateStatus = (prev: StatusDoc | null, at: string, results: RunResult[], limits = STATUS_LIMITS): StatusDoc => {
  const feeds: StatusDoc["feeds"] = { ...(prev?.feeds ?? {}) };
  const incidents = (prev?.incidents ?? []).map((i) => ({ ...i }));
  const run: RunRecord = { at, feeds: {} };

  for (const r of results) {
    const before = feeds[r.feed];
    feeds[r.feed] = {
      status: r.status,
      sourceTime: r.sourceTime,
      ageMinutes: r.ageMinutes,
      lastAttemptAt: at,
      lastAttemptOk: r.attemptOk,
      lastSuccessAt: r.attemptOk ? at : (before?.lastSuccessAt ?? null),
      lastError: r.attemptOk ? null : r.error,
    };
    run.feeds[r.feed] = { status: r.status, age: r.ageMinutes, ok: r.attemptOk };

    const open = incidents.find((i) => i.feed === r.feed && i.endedAt === null);
    const problem = problemOf(r);
    if (open && (!problem || problem.kind !== open.kind)) open.endedAt = at;
    if (problem && (!open || open.endedAt !== null)) incidents.push({ feed: r.feed, kind: problem.kind, startedAt: at, endedAt: null, detail: problem.detail });
  }

  return {
    schemaVersion: 1,
    generatedAt: at,
    feeds,
    runs: [...(prev?.runs ?? []), run].slice(-limits.runs),
    // Keep every open incident; drop the oldest closed ones first.
    incidents: incidents.filter((i, idx) => i.endedAt === null || idx >= incidents.length - limits.incidents),
  };
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export const isStatusDoc = (value: unknown): value is StatusDoc =>
  isRecord(value) &&
  value.schemaVersion === 1 &&
  typeof value.generatedAt === "string" &&
  isRecord(value.feeds) &&
  Object.entries(value.feeds).every(([k, f]) => k in FEEDS && isRecord(f) && FEED_STATUSES.includes(f.status as FeedStatus)) &&
  Array.isArray(value.runs) &&
  value.runs.every((r) => isRecord(r) && typeof r.at === "string" && isRecord(r.feeds)) &&
  Array.isArray(value.incidents) &&
  value.incidents.every((i) => isRecord(i) && typeof i.feed === "string" && typeof i.startedAt === "string");

/** Nearest-rank percentile; undefined for an empty list. */
export const percentile = (values: number[], p: number): number | undefined => {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
};
