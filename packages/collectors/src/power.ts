import { toIso } from "@taiwan-life-data/contract";
import { carbonIntensity, fuelCategory, LOW_CARBON, RENEWABLE, type FuelCategory, type Intensity, FACTORS_VERSION } from "./carbon";
import { asRecord, isRecord, toText, ValidationError } from "./parse";

/**
 * Taipower open data (ported from taiwan-power-dashboard `summarizeGenerationUnits` /
 * `normalizeSupplyPayload`). Neither file sends CORS headers, so only the collect step reads them.
 */
export const TAIPOWER_FILES = {
  generation: "https://service.taipower.com.tw/data/opendata/apply/file/d006001/001.json",
  supply: "https://service.taipower.com.tw/data/opendata/apply/file/d006020/001.json",
} as const;

export interface PowerCategory {
  category: FuelCategory;
  /** Net generation (MW); storage-load is negative while charging. */
  mw: number;
  units: number;
}

export interface PowerLoad {
  /** Current load (MW). */
  currentMw: number;
  /** Today's forecast peak reserve margin (%), and Taipower's official G/Y/O/R/B light. */
  reservePercent: number;
  indicator: "G" | "Y" | "O" | "R" | "B";
  publishedAt: string;
}

export interface PowerData {
  /** d006001 DateTime (Asia/Taipei, every 10 minutes). */
  observedAt: string;
  categories: PowerCategory[];
  /** Primary generation (excludes storage in and out), MW. */
  generationMw: number;
  intensity: Intensity;
  factorsVersion: string;
  /** Shares of primary generation, %. */
  lowCarbonPercent: number;
  renewablePercent: number;
  /** From d006020; null when that file failed (generation alone is still valid). */
  load: PowerLoad | null;
}

const MIN_UNITS = 100;
const MIN_KNOWN_RATIO = 0.98;
const FUTURE_TOLERANCE_MS = 15 * 60_000;

/** "1,234.5", "N/A", "-", "13645.8(50.402%)" → number | undefined. Subtotal rows carry the "(x%)" form. */
const mwValue = (value: unknown): number | undefined => {
  const text = typeof value === "number" ? String(value) : toText(value);
  if (!text) return undefined;
  const clean = text.replaceAll(",", "");
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(clean)) return undefined;
  return Number(clean);
};

/** Taipower writes Taipei wall-clock time without an offset: "2026-10-16T01:30:00". */
const parseTaipeiLocal = (value: unknown): number | undefined => {
  const text = toText(value);
  const m = text && /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(text);
  if (!m) return undefined;
  const ms = Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] ?? "00"}+08:00`);
  return Number.isFinite(ms) ? ms : undefined;
};

const round1 = (n: number) => Math.round(n * 10) / 10;

export const parseGeneration = (payload: unknown, now: number): Omit<PowerData, "load"> => {
  const record = asRecord(payload);
  const observed = parseTaipeiLocal(record.DateTime);
  if (observed === undefined) throw new ValidationError("power", "DateTime 缺失或格式無效");
  if (observed - now > FUTURE_TOLERANCE_MS) throw new ValidationError("power", "DateTime 在未來");
  if (!Array.isArray(record.aaData)) throw new ValidationError("power", "缺少 aaData");

  const totals = new Map<FuelCategory, PowerCategory>();
  let units = 0;
  let known = 0;
  for (const raw of record.aaData) {
    const row = asRecord(raw);
    const name = toText(row["機組名稱"]);
    const type = toText(row["機組類型"]);
    if (!name || name.startsWith("小計")) continue;
    if (!type) throw new ValidationError("power", `機組 ${name} 缺少類型`);
    units += 1;
    const mw = mwValue(row["淨發電量(MW)"]);
    if (mw === undefined) continue;
    if (mw < -20_000 || mw > 100_000) throw new ValidationError("power", `機組 ${name} 發電量超出可信範圍`);
    known += 1;
    const category = fuelCategory(type);
    const entry = totals.get(category) ?? { category, mw: 0, units: 0 };
    entry.mw += mw;
    entry.units += 1;
    totals.set(category, entry);
  }
  if (units < MIN_UNITS) throw new ValidationError("power", `機組 ${units} 筆，少於 ${MIN_UNITS}`);
  if (known / units < MIN_KNOWN_RATIO) throw new ValidationError("power", `可讀發電量的機組比例 ${(known / units).toFixed(2)} 過低`);

  const categories = [...totals.values()].map((c) => ({ ...c, mw: round1(c.mw) })).sort((a, b) => b.mw - a.mw);
  const mix = Object.fromEntries(categories.map((c) => [c.category, c.mw])) as Partial<Record<FuelCategory, number>>;
  const intensity = carbonIntensity(mix);
  if (!intensity || intensity.basisMw < 5_000 || intensity.basisMw > 60_000) throw new ValidationError("power", "發電總量不在可信範圍");
  const share = (set: ReadonlySet<FuelCategory>) =>
    round1((categories.filter((c) => set.has(c.category)).reduce((sum, c) => sum + Math.max(0, c.mw), 0) / intensity.basisMw) * 100);

  return {
    observedAt: toIso(observed)!,
    categories,
    generationMw: intensity.basisMw,
    intensity,
    factorsVersion: FACTORS_VERSION,
    lowCarbonPercent: share(LOW_CARBON),
    renewablePercent: share(RENEWABLE),
  };
};

/** "115.10.16(五)01:30" (ROC calendar, Taipei time). */
const parseRocTime = (value: unknown): number | undefined => {
  const m = toText(value) && /^(\d{2,3})[./-](\d{1,2})[./-](\d{1,2})(?:\([^)]*\))?\s*(\d{1,2}):(\d{2})$/.exec(toText(value)!);
  if (!m) return undefined;
  const pad = (s: string) => s.padStart(2, "0");
  const ms = Date.parse(`${Number(m[1]) + 1911}-${pad(m[2]!)}-${pad(m[3]!)}T${pad(m[4]!)}:${m[5]}:00+08:00`);
  return Number.isFinite(ms) ? ms : undefined;
};

/** d006020. Values are in units of 10 MW. */
export const parseSupply = (payload: unknown, now: number): PowerLoad => {
  const record = asRecord(payload);
  if (String(record.success).toLowerCase() !== "true" || !Array.isArray(record.records)) throw new ValidationError("power", "供需資料格式無效");
  const records: unknown[] = record.records;
  const find = (field: string) => asRecord(records.find((r) => isRecord(r) && r[field] !== undefined));
  const current = find("curr_load");
  const forecast = find("fore_peak_resv_rate");
  const load = mwValue(current.curr_load);
  const reserve = mwValue(forecast.fore_peak_resv_rate);
  const indicator = toText(forecast.fore_peak_resv_indicator)?.toUpperCase();
  const published = parseRocTime(forecast.publish_time);
  if (load === undefined || load < 100 || load > 10_000) throw new ValidationError("power", "目前負載缺失或不合理");
  if (reserve === undefined || reserve < 0 || reserve > 100) throw new ValidationError("power", "備轉容量率缺失或不合理");
  if (indicator !== "G" && indicator !== "Y" && indicator !== "O" && indicator !== "R" && indicator !== "B") throw new ValidationError("power", "供電燈號無效");
  if (published === undefined || published - now > FUTURE_TOLERANCE_MS) throw new ValidationError("power", "供需發布時間無效");
  return { currentMw: round1(load * 10), reservePercent: reserve, indicator, publishedAt: toIso(published)! };
};

/** Generation and load come from different files; they must describe roughly the same moment and total. */
export const combinePower = (generation: Omit<PowerData, "load">, load: PowerLoad | null): { data: PowerData; issues: string[] } => {
  const issues: string[] = [];
  let kept = load;
  if (load) {
    const skewMinutes = Math.abs(Date.parse(load.publishedAt) - Date.parse(generation.observedAt)) / 60_000;
    // Net generation incl. storage should match load within ±10% (same check as taiwan-power-dashboard).
    const net = generation.categories.reduce((sum, c) => sum + c.mw, 0);
    const ratio = net / load.currentMw;
    if (skewMinutes > 60) {
      issues.push("供需資料與機組資料時間相差超過 60 分鐘，不採用供需資料");
      kept = null;
    } else if (ratio < 0.9 || ratio > 1.1) {
      issues.push("機組發電加總與目前負載差距超過 10%，不採用供需資料");
      kept = null;
    }
  }
  return { data: { ...generation, load: kept }, issues };
};

export const isPowerData = (value: unknown): value is PowerData =>
  isRecord(value) &&
  typeof value.observedAt === "string" &&
  Array.isArray(value.categories) &&
  value.categories.every((c) => isRecord(c) && typeof c.category === "string" && typeof c.mw === "number") &&
  isRecord(value.intensity) &&
  typeof value.intensity.lifecycle === "number" &&
  typeof value.intensity.direct === "number" &&
  (value.load === null || isRecord(value.load));
