import { activeHazards, type FeedDataMap, type HeatWarning } from "@taiwan-life-data/collectors";
import { formatTaipei } from "@taiwan-life-data/contract";

export type Tone = "ok" | "notice" | "warn" | "danger" | "unknown";

export interface Verdict {
  tone: Tone;
  headline: string;
  details: string[];
}

const NO_DATA: Verdict = { tone: "unknown", headline: "沒有資料", details: [] };

export const assessWarnings = (data: FeedDataMap["warnings"], county: string, now: number): Verdict => {
  const hazards = activeHazards(data.counties.find((c) => c.county === county), now);
  if (!hazards.length) return { tone: "ok", headline: "目前沒有生效中的天氣警特報", details: [] };
  return {
    tone: hazards.some((h) => /豪雨|颱風|大雨/.test(h.phenomena)) ? "danger" : "warn",
    headline: hazards.map((h) => `${h.phenomena}${h.significance}`).join("、"),
    details: hazards.map((h) => `${h.phenomena}${h.significance}：${formatTaipei(h.startTime)} 起至 ${formatTaipei(h.endTime)}${h.affectedAreas.length ? `（${h.affectedAreas.join("、")}）` : ""}`),
  };
};

const HEAT_TONE: Record<HeatWarning, Tone> = { 注意: "notice", 警戒: "warn", 危險: "danger", 高危險: "danger" };
const HEAT_RANK: Record<HeatWarning, number> = { 注意: 1, 警戒: 2, 危險: 3, 高危險: 4 };
const SLOT_MS = 3 * 3_600_000;

export const assessHeat = (data: FeedDataMap["heat"], county: string, now: number): Verdict => {
  const towns = data.towns.filter((t) => t.county === county);
  if (!towns.length) return NO_DATA;
  const worst = (from: number, to: number) => {
    let best: { warning: HeatWarning; town: string; time: string } | undefined;
    for (const town of towns) {
      for (const p of town.points) {
        const t = Date.parse(p.time);
        if (t + SLOT_MS <= from || t >= to || !p.warning) continue;
        if (!best || HEAT_RANK[p.warning] > HEAT_RANK[best.warning]) best = { warning: p.warning, town: town.town, time: p.time };
      }
    }
    return best;
  };
  const current = worst(now, now + 1);
  const next24 = worst(now, now + 24 * 3_600_000);
  const details = [`${towns.length} 個鄉鎮市區的官方熱傷害預報（逐 3 小時）`];
  if (next24) details.push(`未來 24 小時最高：${next24.warning}（${next24.town}，${formatTaipei(next24.time)} 起）`);
  if (!current) return { tone: next24 ? "notice" : "ok", headline: "現在沒有熱傷害警示", details };
  return { tone: HEAT_TONE[current.warning], headline: `熱傷害「${current.warning}」（${current.town}等地）`, details };
};

const uvLevel = (uv: number): { label: string; tone: Tone } =>
  uv >= 11 ? { label: "危險級", tone: "danger" } : uv >= 8 ? { label: "過量級", tone: "danger" } : uv >= 6 ? { label: "高量級", tone: "warn" } : uv >= 3 ? { label: "中量級", tone: "notice" } : { label: "低量級", tone: "ok" };

export const assessUv = (data: FeedDataMap["uv"], county: string): Verdict => {
  const stations = data.stations.filter((s) => s.county === county);
  const uv = stations.filter((s) => s.uvIndex !== null).sort((a, b) => b.uvIndex! - a.uvIndex!);
  const temps = stations.filter((s) => s.temperature !== null).sort((a, b) => b.temperature! - a.temperature!);
  const details: string[] = [];
  if (temps[0]) details.push(`最高氣溫 ${temps[0].temperature}°C（${temps[0].name}，${formatTaipei(temps[0].observedAt)}）`);
  if (!uv[0]) return { tone: "unknown", headline: "本縣市沒有紫外線測站，不推估", details };
  const level = uvLevel(uv[0].uvIndex!);
  details.unshift(`${uv[0].name}測站 ${formatTaipei(uv[0].observedAt)} 觀測`);
  return { tone: level.tone, headline: `紫外線 ${uv[0].uvIndex}（${level.label}）`, details };
};

const aqiTone = (aqi: number): Tone => (aqi > 150 ? "danger" : aqi > 100 ? "warn" : aqi > 50 ? "notice" : "ok");

export const assessAqi = (data: FeedDataMap["aqi"], county: string): Verdict => {
  const stations = data.stations.filter((s) => s.county === county).sort((a, b) => b.aqi - a.aqi);
  const worst = stations[0];
  if (!worst) return NO_DATA;
  return {
    tone: aqiTone(worst.aqi),
    headline: `AQI 最高 ${worst.aqi}（${worst.status || "—"}）`,
    details: [
      `${worst.name}測站${worst.pollutant ? `，主要污染物 ${worst.pollutant}` : ""}${worst.pm25 !== null ? `，PM2.5 ${worst.pm25} μg/m³` : ""}`,
      `本縣市 ${stations.length} 個測站：${stations.map((s) => `${s.name} ${s.aqi}`).join("、")}`,
    ],
  };
};
