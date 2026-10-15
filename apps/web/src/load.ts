import { collectFeed, createJsonFetcher, parseFeedEnvelope, type BrowserFeedId, type FeedDataMap } from "@taiwan-life-data/collectors";
import { currentStatus, FEEDS, parseOfficialTime, type FeedEnvelope, type FeedId, type FeedStatus } from "@taiwan-life-data/contract";

export type Envelope<K extends FeedId> = FeedEnvelope<FeedDataMap[K]>;

export const loadSnapshot = async <K extends FeedId>(feed: K): Promise<Envelope<K> | null> => {
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}data/${feed}.json`, { cache: "no-cache" });
    if (!response.ok) return null;
    return parseFeedEnvelope(feed, await response.json());
  } catch {
    return null;
  }
};

/**
 * Reads the official keyless, CORS-enabled file straight from the browser
 * (docs/DECISIONS.md D2). Rain reads only the chosen county's file (~1 MB).
 * Returns null when the read or validation fails.
 */
export const readOfficial = async <K extends BrowserFeedId>(feed: K, county: string): Promise<Envelope<K> | null> => {
  const envelope = await collectFeed(feed, {
    fetchJson: createJsonFetcher(FEEDS[feed].source.datasetId, 20_000),
    now: Date.now,
    via: "browser",
    counties: feed === "rain" ? [county] : undefined,
  });
  return envelope.data === null ? null : envelope;
};

const RANK: Record<FeedStatus, number> = { live: 3, delayed: 2, stale: 1, unavailable: 0 };

/** Of the envelopes that cover the place, the one with the best status at `now` (ties: newer data). */
export const pickBest = <T>(candidates: Array<FeedEnvelope<T> | null | undefined>, now: number): { envelope: FeedEnvelope<T>; status: FeedStatus } | null => {
  let best: { envelope: FeedEnvelope<T>; status: FeedStatus } | null = null;
  for (const envelope of candidates) {
    if (!envelope || envelope.data === null) continue;
    const status = currentStatus(envelope, now);
    const newer = (parseOfficialTime(envelope.sourceTime) ?? 0) > (parseOfficialTime(best?.envelope.sourceTime) ?? 0);
    if (!best || RANK[status] > RANK[best.status] || (RANK[status] === RANK[best.status] && newer)) best = { envelope, status };
  }
  return best;
};
