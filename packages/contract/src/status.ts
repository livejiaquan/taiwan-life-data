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

/**
 * - collect-failed: the official source could not be read or failed validation.
 * - stale: the published snapshot was stale or unavailable at collect time.
 * - collect-gap: the collector itself did not run for longer than COLLECT_GAP_MINUTES
 *   (scope "collector"; recorded when the next run arrives, shown live by /status).
 */
export type IncidentKind = "collect-failed" | "stale" | "collect-gap";
export type IncidentScope = FeedId | "collector";

export interface Incident {
  feed: IncidentScope;
  kind: IncidentKind;
  startedAt: string;
  endedAt: string | null;
  detail: string;
  /** Last collect run that still saw the problem (older status.json files lack it). */
  lastSeenAt?: string;
  /** Number of collect runs that saw the problem. */
  runs?: number;
  /** Worst data age seen during the incident, minutes. */
  worstAgeMinutes?: number | null;
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

/** The Pages workflow is scheduled every 15 minutes (.github/workflows/pages.yml). */
export const COLLECT_TARGET_MINUTES = 15;
/** A gap longer than this between two collect runs is an incident (4 missed runs). */
export const COLLECT_GAP_MINUTES = 60;

/** Stable key of an incident, used by the archive log and the Atom feed. */
export const incidentKey = (i: Pick<Incident, "feed" | "kind" | "startedAt">) => `${i.feed}/${i.kind}/${i.startedAt}`;

export const formatDuration = (minutes: number): string =>
  minutes < 60 ? `${minutes} 分` : minutes < 48 * 60 ? `${Math.floor(minutes / 60)} 小時${minutes % 60 ? ` ${minutes % 60} 分` : ""}` : `${Math.round(minutes / 1440)} 天`;

const gapDetail = (minutes: number) =>
  `兩次收集相隔 ${formatDuration(minutes)}（排程目標每 ${COLLECT_TARGET_MINUTES} 分鐘）；這段期間快照沒有更新，空品與電網碳強度只能等收集`;

const problemOf = (r: RunResult): { kind: IncidentKind; detail: string } | null => {
  if (!r.attemptOk) return { kind: "collect-failed", detail: r.error ?? "讀取或驗證失敗" };
  if (r.status === "stale" || r.status === "unavailable") return { kind: "stale", detail: `收集時資料${r.status === "stale" ? "過舊" : "無法取得"}（資料年齡 ${r.ageMinutes ?? "?"} 分鐘）` };
  return null;
};

const maxAge = (a: number | null | undefined, b: number | null) => (a == null ? b : b == null ? a : Math.max(a, b));

/** Folds one collect run into the previous status document. Pure. */
export const updateStatus = (prev: StatusDoc | null, at: string, results: RunResult[], limits = STATUS_LIMITS): StatusDoc => {
  const feeds: StatusDoc["feeds"] = { ...(prev?.feeds ?? {}) };
  const incidents = (prev?.incidents ?? []).map((i) => ({ ...i }));
  const run: RunRecord = { at, feeds: {} };

  const lastRun = prev?.runs.at(-1)?.at;
  const gap = lastRun ? Math.round((Date.parse(at) - Date.parse(lastRun)) / 60_000) : 0;
  if (lastRun && gap > COLLECT_GAP_MINUTES) incidents.push({ feed: "collector", kind: "collect-gap", startedAt: lastRun, endedAt: at, detail: gapDetail(gap), lastSeenAt: at, runs: 0, worstAgeMinutes: null });

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
    if (problem && open && open.endedAt === null) {
      open.lastSeenAt = at;
      open.runs = (open.runs ?? 1) + 1;
      open.worstAgeMinutes = maxAge(open.worstAgeMinutes, r.ageMinutes);
    }
    if (problem && (!open || open.endedAt !== null)) incidents.push({ feed: r.feed, kind: problem.kind, startedAt: at, endedAt: null, detail: problem.detail, lastSeenAt: at, runs: 1, worstAgeMinutes: r.ageMinutes });
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
  value.incidents.every(isIncident);

const INCIDENT_KINDS: readonly IncidentKind[] = ["collect-failed", "stale", "collect-gap"];

export const isIncident = (i: unknown): i is Incident =>
  isRecord(i) &&
  (i.feed === "collector" || (typeof i.feed === "string" && i.feed in FEEDS)) &&
  INCIDENT_KINDS.includes(i.kind as IncidentKind) &&
  typeof i.startedAt === "string" &&
  (i.endedAt === null || typeof i.endedAt === "string") &&
  typeof i.detail === "string";

/**
 * The collector has not run for too long *right now*. A gap is only written to
 * status.json when the next run arrives, so readers compute the open one themselves.
 */
export const openCollectGap = (doc: StatusDoc, now: number): Incident | null => {
  const last = doc.runs.at(-1)?.at;
  if (!last) return null;
  const gap = Math.round((now - Date.parse(last)) / 60_000);
  return gap > COLLECT_GAP_MINUTES ? { feed: "collector", kind: "collect-gap", startedAt: last, endedAt: null, detail: gapDetail(gap), runs: 0, worstAgeMinutes: null } : null;
};

export const incidentLabel = (i: Pick<Incident, "feed">) => (i.feed === "collector" ? "收集排程" : FEEDS[i.feed].label);
export const INCIDENT_KIND_TEXT: Record<IncidentKind, string> = { "collect-failed": "收集失敗", stale: "資料過舊", "collect-gap": "收集中斷" };

/** Open first, then newest first. */
export const sortIncidents = (incidents: Incident[]): Incident[] =>
  [...incidents].sort((a, b) => Number(a.endedAt !== null) - Number(b.endedAt !== null) || b.startedAt.localeCompare(a.startedAt));

/** Long-term incident log kept on the archive branch (v1/incidents.json); status.json only keeps the last 100. */
export interface IncidentLog {
  schemaVersion: 1;
  updatedAt: string;
  retentionDays: number;
  incidents: Incident[];
}

export const isIncidentLog = (v: unknown): v is IncidentLog =>
  isRecord(v) && v.schemaVersion === 1 && typeof v.updatedAt === "string" && typeof v.retentionDays === "number" && Array.isArray(v.incidents) && v.incidents.every(isIncident);

/**
 * Merges the incidents of the current status.json into the long-term log. The
 * status version wins for the same key (an open incident gets closed); incidents
 * that started more than `retentionDays` ago are dropped unless still open. Pure.
 */
export const mergeIncidentLog = (prev: IncidentLog | null, current: Incident[], now: number, retentionDays = 90): IncidentLog => {
  const byKey = new Map<string, Incident>();
  for (const i of prev?.incidents ?? []) byKey.set(incidentKey(i), i);
  for (const i of current) byKey.set(incidentKey(i), i);
  const cutoff = now - retentionDays * 86_400_000;
  return {
    schemaVersion: 1,
    updatedAt: new Date(now).toISOString(),
    retentionDays,
    incidents: [...byKey.values()].filter((i) => i.endedAt === null || Date.parse(i.startedAt) >= cutoff).sort((a, b) => a.startedAt.localeCompare(b.startedAt)),
  };
};

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Atom feed of incidents (data/incidents.xml) so people can subscribe to outages. */
export const incidentsAtom = (doc: StatusDoc, siteUrl: string, limit = 50): string => {
  const site = siteUrl.replace(/\/?$/, "/");
  const entries = sortIncidents(doc.incidents).slice(0, limit).map((i) => {
    const updated = i.endedAt ?? i.lastSeenAt ?? i.startedAt;
    const state = i.endedAt ? "已恢復" : "進行中";
    const span = i.endedAt ? `${i.startedAt} → ${i.endedAt}（${formatDuration(Math.round((Date.parse(i.endedAt) - Date.parse(i.startedAt)) / 60_000))}）` : `${i.startedAt} 起，尚未恢復`;
    return [
      "  <entry>",
      `    <id>tag:livejiaquan.github.io,2026:taiwan-life-data/incident/${xml(incidentKey(i))}</id>`,
      `    <title>[${state}] ${xml(incidentLabel(i))}：${INCIDENT_KIND_TEXT[i.kind]}</title>`,
      `    <updated>${xml(updated)}</updated>`,
      `    <published>${xml(i.startedAt)}</published>`,
      `    <link href="${xml(site)}status/"/>`,
      `    <summary>${xml(`${span}。${i.detail}`)}</summary>`,
      "  </entry>",
    ].join("\n");
  });
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    "  <id>tag:livejiaquan.github.io,2026:taiwan-life-data/incidents</id>",
    "  <title>台灣生活資料誌｜資料事故紀錄</title>",
    `  <updated>${xml(doc.generatedAt)}</updated>`,
    `  <link rel="alternate" href="${xml(site)}status/"/>`,
    `  <link rel="self" href="${xml(site)}data/incidents.xml"/>`,
    "  <author><name>taiwan-life-data collector</name></author>",
    ...entries,
    "</feed>",
    "",
  ].join("\n");
};

/** Nearest-rank percentile; undefined for an empty list. */
export const percentile = (values: number[], p: number): number | undefined => {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
};
