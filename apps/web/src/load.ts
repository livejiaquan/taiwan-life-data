import { BROWSER_FETCHABLE, collectFeed, createJsonFetcher, parseFeedEnvelope, type BrowserFeedId, type FeedDataMap } from "@taiwan-life-data/collectors";
import { currentStatus, FEEDS, type FeedEnvelope, type FeedId, type FeedStatus } from "@taiwan-life-data/contract";

export interface LoadedFeed<K extends FeedId> {
  envelope: FeedEnvelope<FeedDataMap[K]> | null;
  status: FeedStatus;
}

const loadSnapshot = async <K extends FeedId>(feed: K): Promise<FeedEnvelope<FeedDataMap[K]> | null> => {
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}data/${feed}.json`, { cache: "no-cache" });
    if (!response.ok) return null;
    return parseFeedEnvelope(feed, await response.json());
  } catch {
    return null;
  }
};

/**
 * Snapshot first; if it is not live and the official file is keyless + CORS-enabled,
 * read the official file directly from the browser (docs/DECISIONS.md D2).
 * Whatever is shown is re-graded at `now` — a snapshot never claims to be live.
 */
export const loadFeed = async <K extends FeedId>(feed: K, now = Date.now()): Promise<LoadedFeed<K>> => {
  const snapshot = await loadSnapshot(feed);
  const snapshotStatus: FeedStatus = snapshot ? currentStatus(snapshot, now) : "unavailable";
  if (snapshotStatus === "live" || !BROWSER_FETCHABLE.includes(feed)) return { envelope: snapshot, status: snapshotStatus };

  const live = (await collectFeed(feed as BrowserFeedId, {
    fetchJson: createJsonFetcher(FEEDS[feed].source.datasetId, 20_000),
    now: Date.now,
    via: "browser",
  })) as FeedEnvelope<FeedDataMap[K]>;
  if (live.data !== null) return { envelope: live, status: currentStatus(live, Date.now()) };
  return { envelope: snapshot ?? live, status: snapshot ? snapshotStatus : "unavailable" };
};
