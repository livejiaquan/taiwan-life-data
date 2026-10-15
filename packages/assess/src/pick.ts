import { currentStatus, FEEDS, parseOfficialTime, type FeedEnvelope, type FeedStatus } from "@taiwan-life-data/contract";

const RANK: Record<FeedStatus, number> = { live: 3, delayed: 2, stale: 1, unavailable: 0 };

/** The time freshness is measured by: warnings are current because they were read recently (retrievedAt). */
const basisTime = (e: FeedEnvelope<unknown> | undefined) =>
  e ? (parseOfficialTime((FEEDS[e.feed].freshness.basis === "retrievedAt" ? e.retrievedAt : e.sourceTime) ?? undefined) ?? 0) : 0;

/** Of the envelopes that cover the place, the one with the best status at `now` (ties: newer by the feed's freshness basis). */
export const pickBest = <T>(candidates: Array<FeedEnvelope<T> | null | undefined>, now: number): { envelope: FeedEnvelope<T>; status: FeedStatus } | null => {
  let best: { envelope: FeedEnvelope<T>; status: FeedStatus } | null = null;
  for (const envelope of candidates) {
    if (!envelope || envelope.data === null) continue;
    const status = currentStatus(envelope, now);
    const newer = basisTime(envelope) > basisTime(best?.envelope);
    if (!best || RANK[status] > RANK[best.status] || (RANK[status] === RANK[best.status] && newer)) best = { envelope, status };
  }
  return best;
};
