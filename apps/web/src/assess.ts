import { activeHazards, type FeedDataMap, type HeatWarning } from "@taiwan-life-data/collectors";
import { distanceKm, formatTaipei, type Town } from "@taiwan-life-data/contract";

export type Tone = "ok" | "notice" | "warn" | "danger" | "unknown";

export interface Verdict {
  tone: Tone;
  headline: string;
  details: string[];
  /** Coloured, but not worth calling out in the summary (e.g. AQI 普通). */
  quiet?: boolean;
}

const NO_DATA: Verdict = { tone: "unknown", headline: "沒有這個地區的資料", details: [] };
const HOUR = 3_600_000;
const SLOT_MS = 3 * HOUR;

const HOUR_FORMAT = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Taipei", hour: "2-digit", hourCycle: "h23" });
/** Taiwan wall-clock hour, "00"–"23". */
const hourOf = (iso: string) => HOUR_FORMAT.format(new Date(iso)).padStart(2, "0");

const km = (d: number) => (d < 1 ? "1 公里內" : `約 ${Math.round(d)} 公里`);

/** Nearest item with coordinates; items without coordinates (old snapshots) are ranked last. */
const nearest = <T extends { lat?: number | null; lon?: number | null }>(items: T[], town: Town): Array<{ item: T; distance: number | null }> =>
  items
    .map((item) => ({ item, distance: item.lat != null && item.lon != null ? distanceKm(town, { lat: item.lat, lon: item.lon }) : null }))
    .sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));

/** Warnings are issued per county; sub-areas (山區 etc.) are listed when CWA names them. */
export const assessWarnings = (data: FeedDataMap["warnings"], town: Town, now: number): Verdict => {
  const hazards = activeHazards(data.counties.find((c) => c.county === town.county), now);
  if (!hazards.length) return { tone: "ok", headline: "目前沒有生效中的天氣警特報", details: [`警特報以縣市為單位發布（${town.county}）`] };
  return {
    tone: hazards.some((h) => /豪雨|颱風|大雨/.test(h.phenomena)) ? "danger" : "warn",
    headline: hazards.map((h) => `${h.phenomena}${h.significance}`).join("、"),
    details: hazards.map((h) => `${h.phenomena}${h.significance}：${formatTaipei(h.startTime)} 起至 ${formatTaipei(h.endTime)}${h.affectedAreas.length ? `（${h.affectedAreas.join("、")}）` : `（${town.county}全區）`}`),
  };
};

const HEAT_TONE: Record<HeatWarning, Tone> = { 注意: "notice", 警戒: "warn", 危險: "danger", 高危險: "danger" };
const HEAT_RANK: Record<HeatWarning, number> = { 注意: 1, 警戒: 2, 危險: 3, 高危險: 4 };

export const assessHeat = (data: FeedDataMap["heat"], town: Town, now: number): Verdict => {
  const entry = data.towns.find((t) => t.geocode === town.geocode);
  if (!entry) return NO_DATA;
  const current = entry.points.find((p) => Date.parse(p.time) <= now && now < Date.parse(p.time) + SLOT_MS);
  let peak: (typeof entry.points)[number] | undefined;
  for (const p of entry.points) {
    const t = Date.parse(p.time);
    if (t + SLOT_MS <= now || t >= now + 24 * HOUR || !p.warning) continue;
    if (!peak || HEAT_RANK[p.warning] > HEAT_RANK[peak.warning!]) peak = p;
  }
  if (!current) return { tone: "unknown", headline: "預報沒有涵蓋現在這個時段", details: [] };
  const details: string[] = [];
  if (current.index !== null) details.push(`現在熱傷害指數 ${current.index}（${hourOf(current.time)}–${hourOf(new Date(Date.parse(current.time) + SLOT_MS).toISOString())} 時）`);
  details.push(peak ? `未來 24 小時最高：${peak.warning}（${formatTaipei(peak.time)} 起）` : "未來 24 小時沒有熱傷害警示");
  if (!current.warning) return { tone: peak ? "notice" : "ok", headline: "現在沒有熱傷害警示", details };
  return { tone: HEAT_TONE[current.warning], headline: `熱傷害「${current.warning}」`, details };
};

const uvLevel = (uv: number): { label: string; tone: Tone } =>
  uv >= 11 ? { label: "危險級", tone: "danger" } : uv >= 8 ? { label: "過量級", tone: "danger" } : uv >= 6 ? { label: "高量級", tone: "warn" } : uv >= 3 ? { label: "中量級", tone: "notice" } : { label: "低量級", tone: "ok" };

/**
 * About 30 stations measure UV, so the nearest UV station in the same county is
 * used and its distance shown. Never borrowed from another county (DECISIONS D8).
 */
export const assessUv = (data: FeedDataMap["uv"], town: Town): Verdict => {
  const inCounty = data.stations.filter((s) => s.county === town.county);
  const details: string[] = [];
  const sameTown = inCounty.filter((s) => s.temperature !== null && s.townCode === town.geocode);
  const temp = nearest(sameTown.length ? sameTown : inCounty.filter((s) => s.temperature !== null), town)[0];
  if (temp) details.push(`氣溫 ${temp.item.temperature}°C（${temp.item.name}測站${temp.distance !== null ? `，${km(temp.distance)}` : ""}，${formatTaipei(temp.item.observedAt)}）`);
  const uv = nearest(inCounty.filter((s) => s.uvIndex !== null), town)[0];
  if (!uv) return { tone: "unknown", headline: "本縣市沒有紫外線測站，不推估", details };
  const level = uvLevel(uv.item.uvIndex!);
  details.unshift(`${uv.item.name}測站${uv.distance !== null ? `（${km(uv.distance)}）` : ""} ${formatTaipei(uv.item.observedAt)} 觀測`);
  return { tone: level.tone, headline: `紫外線 ${uv.item.uvIndex}（${level.label}）`, details };
};

const aqiTone = (aqi: number): Tone => (aqi > 150 ? "danger" : aqi > 100 ? "warn" : aqi > 50 ? "notice" : "ok");

export const assessAqi = (data: FeedDataMap["aqi"], town: Town): Verdict => {
  const ranked = nearest(data.stations.filter((s) => s.county === town.county), town);
  const near = ranked[0];
  if (!near) return NO_DATA;
  const s = near.item;
  const worst = [...ranked].sort((a, b) => b.item.aqi - a.item.aqi)[0]!.item;
  const details = [
    `最近測站：${s.name}${near.distance !== null ? `（${km(near.distance)}）` : ""}${s.pollutant ? `，主要污染物 ${s.pollutant}` : ""}${s.pm25 !== null ? `，PM2.5 ${s.pm25} μg/m³` : ""}`,
  ];
  if (ranked.length > 1) details.push(`${town.county} ${ranked.length} 站中最高：${worst.name} ${worst.aqi}`);
  return { tone: aqiTone(s.aqi), headline: `AQI ${s.aqi}（${s.status || "—"}）`, details, quiet: s.aqi <= 100 };
};

export const assessRain = (data: FeedDataMap["rain"], town: Town, now: number): Verdict => {
  const entry = data.towns.find((t) => t.geocode === town.geocode);
  if (!entry) return NO_DATA;
  const next = entry.slots.filter((s) => Date.parse(s.start) + SLOT_MS > now).slice(0, 4);
  const known = next.filter((s) => s.pop !== null);
  if (!known.length) return { tone: "unknown", headline: "預報沒有涵蓋接下來 12 小時", details: [] };
  const peak = known.reduce((a, b) => (b.pop! > a.pop! ? b : a));
  const tone: Tone = peak.pop! >= 70 ? "warn" : peak.pop! >= 30 ? "notice" : "ok";
  const advice = peak.pop! >= 50 ? "，建議帶傘" : peak.pop! >= 30 ? "，可備傘" : "";
  return {
    tone,
    headline: `未來 12 小時降雨機率最高 ${peak.pop}%${advice}`,
    details: [next.map((s) => `${hourOf(s.start)}時 ${s.pop ?? "—"}%${s.weather ? ` ${s.weather}` : ""}`).join("・")],
  };
};

const TONE_RANK: Record<Tone, number> = { unknown: -1, ok: 0, notice: 1, warn: 2, danger: 3 };

/** One line for the top of the card and the share text. */
export const summarize = (items: Array<{ label: string; verdict: Verdict | null; pending: boolean }>): { tone: Tone; text: string } => {
  const pending = items.filter((i) => i.pending);
  const flagged = items.filter((i) => i.verdict && !i.verdict.quiet && TONE_RANK[i.verdict.tone] >= 1).sort((a, b) => TONE_RANK[b.verdict!.tone] - TONE_RANK[a.verdict!.tone]);
  const unknown = items.filter((i) => !i.pending && (!i.verdict || i.verdict.tone === "unknown"));
  if (pending.length === items.length) return { tone: "unknown", text: "讀取官方資料中…" };
  const parts: string[] = [];
  if (flagged.length) parts.push(`留意${flagged.map((i) => i.label).join("、")}`);
  else if (!unknown.length && !pending.length) parts.push("各項都在一般範圍，正常出門");
  else parts.push("已知項目沒有需要特別留意的");
  if (unknown.length) parts.push(`${unknown.map((i) => i.label).join("、")}無法判斷`);
  if (pending.length) parts.push(`${pending.length} 項讀取中`);
  const tone = flagged[0]?.verdict?.tone ?? (unknown.length ? "unknown" : "ok");
  return { tone, text: parts.join("；") };
};
