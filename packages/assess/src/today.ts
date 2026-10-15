import type { FeedDataMap, HourWindow, PowerProfile, Reservoir, ReservoirRegion } from "@taiwan-life-data/collectors";
import { RESERVOIR_MAX_AGE_HOURS } from "@taiwan-life-data/collectors";
import { FEEDS } from "@taiwan-life-data/contract";
import type { Tone } from "./assess";

export const CATEGORY_LABEL: Record<string, string> = {
  gas: "燃氣",
  coal: "燃煤",
  oil: "燃油",
  cogeneration: "汽電共生",
  nuclear: "核能",
  hydro: "水力",
  wind: "風力",
  solar: "太陽能",
  "other-renewable": "其他再生能源",
  storage: "儲能放電",
  "storage-load": "儲能充電",
  other: "其他",
};

export const windowText = (w: HourWindow) => `${String(w.startHour).padStart(2, "0")}:00–${String(w.endHour).padStart(2, "0")}:00`;

const taipeiHour = (ms: number) => new Date(ms + 8 * 3_600_000).getUTCHours();

export interface PowerVerdict {
  tone: Tone;
  headline: string;
  details: string[];
}

/** A profile is only a fair comparison when its newest sample is recent (Codex review). */
export const PROFILE_MAX_AGE_DAYS = 3;
export const usableProfile = (profile: PowerProfile | null, now: number): PowerProfile | null =>
  profile && !profile.insufficient && profile.to && now - Date.parse(profile.to) <= PROFILE_MAX_AGE_DAYS * 86_400_000 ? profile : null;

/** Only called for live/delayed data; stale or unavailable data gets no verdict (fail-closed). */
export const assessPower = (data: FeedDataMap["power"], profile: PowerProfile | null, now: number): PowerVerdict => {
  const g = data.intensity.lifecycle;
  const details = [`低碳電力（再生能源＋核能）占 ${data.lowCarbonPercent}%`, `直接排放（只算燃燒）約 ${data.intensity.direct} 公克／度`];
  let tone: Tone = "ok";
  // Only a profile with enough samples is a fair comparison.
  const fair = usableProfile(profile, now);
  const typical = fair ? (fair.hours[taipeiHour(Date.parse(data.observedAt))]?.lifecycle ?? null) : null;
  if (typical) {
    const diff = Math.round(((g - typical) / typical) * 100);
    details.unshift(Math.abs(diff) < 3 ? `和最近 14 天同一時段的平均（${typical} 公克）差不多` : `比最近 14 天同一時段的平均（${typical} 公克）${diff > 0 ? "高" : "低"} ${Math.abs(diff)}%`);
    if (diff >= 5) tone = "notice";
  }
  // The load file has its own time; it must be as fresh as the power feed's delayed window.
  if (data.load && now - Date.parse(data.load.publishedAt) <= FEEDS.power.freshness.delayedForMinutes * 60_000) details.push(`目前負載 ${Math.round(data.load.currentMw).toLocaleString("zh-TW")} MW；今日預估備轉容量率 ${data.load.reservePercent}%（台電燈號 ${data.load.indicator}）`);
  return { tone, headline: `目前每度電約 ${g} 公克 CO₂e`, details };
};

export const REGION_LABEL: Record<ReservoirRegion, string> = { north: "北部", central: "中部", south: "南部" };

export interface ReservoirRow extends Reservoir {
  /** Per-reservoir fail-closed: a reading older than the cutoff is listed without a value. */
  fresh: boolean;
}

export const reservoirRows = (data: FeedDataMap["reservoir"], now: number): Record<ReservoirRegion, ReservoirRow[]> => {
  const out: Record<ReservoirRegion, ReservoirRow[]> = { north: [], central: [], south: [] };
  for (const r of data.reservoirs) out[r.region].push({ ...r, fresh: now - Date.parse(r.observedAt) <= RESERVOIR_MAX_AGE_HOURS * 3_600_000 });
  return out;
};

export const reservoirTone = (percent: number): Tone => (percent < 30 ? "danger" : percent < 50 ? "warn" : percent < 80 ? "notice" : "ok");
