import { covers, pickBest } from "@taiwan-life-data/assess";
import { createJsonFetcher, isPowerProfile, parseFeedEnvelope, type ArchiveIndex, type FeedDataMap, type JsonFetcher, type PowerProfile } from "@taiwan-life-data/collectors";
import { collectAny } from "@taiwan-life-data/collectors/server";
import { FEEDS, isStatusDoc, type FeedEnvelope, type FeedId, type FeedStatus, type StatusDoc, type Town } from "@taiwan-life-data/contract";

export const DEFAULT_SITE = "https://livejiaquan.github.io/taiwan-life-data/";

export interface SourceOptions {
  /** The public site whose /data and /archive this server reads. */
  siteUrl?: string;
  /** Read official files directly when the published snapshot is not live (default true). */
  direct?: boolean;
  /** Optional: your own MOENV key for AQI direct reads; otherwise the link MOENV publishes on data.gov.tw. */
  moenvApiKey?: string;
  now?: () => number;
  /** Injected for tests. */
  fetchJson?: (label: string) => JsonFetcher;
  collect?: typeof collectAny;
  /** Cache lifetime for repeated calls within a conversation. */
  cacheMs?: number;
}

export interface FeedRead<K extends FeedId> {
  envelope: FeedEnvelope<FeedDataMap[K]> | null;
  /** Re-graded at read time; never the stored status. */
  status: FeedStatus;
  /** Where the chosen envelope came from. */
  via: "snapshot" | "official" | null;
  notes: string[];
}

export interface DataSource {
  siteUrl: string;
  now: () => number;
  feed<K extends FeedId>(feed: K, town?: Town): Promise<FeedRead<K>>;
  statusDoc(): Promise<StatusDoc | null>;
  powerProfile(): Promise<PowerProfile | null>;
  archiveIndex(): Promise<ArchiveIndex | null>;
  archiveDay(feed: FeedId, date: string): Promise<unknown>;
}

/**
 * Same order of trust as the website: the published snapshot first, re-graded
 * at read time; when it is not live (or misses the township) the official file
 * is read directly — a local MCP server has no CORS limit, so this works for
 * every feed. The better of the two by current status wins; stale data is
 * returned as stale and callers must not draw conclusions from it.
 */
export const createDataSource = (options: SourceOptions = {}): DataSource => {
  const siteUrl = (options.siteUrl ?? DEFAULT_SITE).replace(/\/?$/, "/");
  const now = options.now ?? Date.now;
  const fetcher = options.fetchJson ?? ((label: string) => createJsonFetcher(label, 30_000));
  const collect = options.collect ?? collectAny;
  const direct = options.direct ?? true;
  const cacheMs = options.cacheMs ?? 120_000;
  const cache = new Map<string, { at: number; value: Promise<unknown> }>();

  const cached = <T>(key: string, load: () => Promise<T>): Promise<T> => {
    const hit = cache.get(key);
    if (hit && now() - hit.at < cacheMs) return hit.value as Promise<T>;
    const value = load();
    cache.set(key, { at: now(), value });
    // A failed load must not be cached.
    value.catch(() => cache.delete(key));
    return value;
  };

  const site = (path: string): Promise<unknown> => cached(`site:${path}`, () => fetcher("taiwan-life-data")(`${siteUrl}${path}`));
  const siteOrNull = (path: string) => site(path).catch(() => null);

  const snapshot = <K extends FeedId>(feed: K): Promise<FeedEnvelope<FeedDataMap[K]> | null> =>
    siteOrNull(`data/${feed}.json`).then((raw) => {
      try {
        return raw === null ? null : (parseFeedEnvelope(feed, raw) as FeedEnvelope<FeedDataMap[K]>);
      } catch {
        return null;
      }
    });

  const official = <K extends FeedId>(feed: K, county: string | undefined): Promise<FeedEnvelope<FeedDataMap[K]>> =>
    cached(`official:${feed}:${feed === "rain" ? county : ""}`, async () => {
      const envelope = await collect(feed, {
        fetchJson: fetcher(FEEDS[feed].source.datasetId),
        now,
        moenvApiKey: options.moenvApiKey,
        counties: feed === "rain" && county ? [county] : undefined,
      });
      // Reject rather than resolve null, so a failed read is not cached.
      if (envelope.data === null) throw new Error(envelope.issues.join("；") || "unavailable");
      return envelope;
    });

  return {
    siteUrl,
    now,
    async feed(feed, town) {
      const notes: string[] = [];
      const snap = await snapshot(feed);
      const snapUsable = town ? covers(feed, snap, town) : !!snap?.data;
      const snapBest = snapUsable ? pickBest([snap], now()) : null;
      let fresh: FeedEnvelope<FeedDataMap[typeof feed]> | null = null;
      // Rain without a township would mean 22 files (~22 MB); only read one county.
      const canRead = direct && (feed !== "rain" || !!town);
      if (snapBest?.status !== "live" && canRead) {
        fresh = await official(feed, town?.county).catch(() => null);
        notes.push(fresh ? "網站快照不是即時，已直接讀官方資料" : "網站快照不是即時，直接讀官方資料也失敗");
      } else if (snapBest?.status !== "live") notes.push("網站快照不是即時（未啟用直接讀官方資料）");
      const candidates = [snapUsable ? snap : null, fresh && (!town || covers(feed, fresh, town)) ? fresh : null];
      const best = pickBest(candidates, now());
      if (!best) return { envelope: snap, status: "unavailable", via: null, notes };
      return { envelope: best.envelope, status: best.status, via: best.envelope === fresh ? "official" : "snapshot", notes };
    },
    statusDoc: () => siteOrNull("data/status.json").then((d) => (isStatusDoc(d) ? d : null)),
    powerProfile: () => siteOrNull("data/power-profile.json").then((d) => (isPowerProfile(d) ? d : null)),
    archiveIndex: () =>
      siteOrNull("archive/v1/index.json").then((d) => (d && typeof d === "object" && (d as ArchiveIndex).schemaVersion === 1 ? (d as ArchiveIndex) : null)),
    archiveDay: (feed, date) => siteOrNull(`archive/v1/${feed}/${date}.json`),
  };
};
