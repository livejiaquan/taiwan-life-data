import { currentStatus, parseOfficialTime, type FeedEnvelope, type FeedStatus } from "@taiwan-life-data/contract";

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
