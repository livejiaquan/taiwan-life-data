import { parseOfficialTime, toIso } from "@taiwan-life-data/contract";
import { asRecord, isRecord, toNumber, toText, ValidationError } from "./parse";

/**
 * WRA open data (ported from taiwan-reservoir-static `parseOpenData` / `validateSnapshot`).
 * Both endpoints are keyless and send `Access-Control-Allow-Origin: *`.
 */
export const WRA_FILES = {
  /** data.gov.tw 45501 水庫水情資料 — hourly rows, several per reservoir. */
  realtime: "https://opendata.wra.gov.tw/api/v2/2be9044c-6e44-4856-aad5-dd108c2e6679?format=JSON&size=1000",
  /** data.gov.tw 41568 水庫每日營運狀況 — effective capacity per reservoir. */
  daily: "https://opendata.wra.gov.tw/api/v2/51023e88-4c76-4dbc-bbb9-470da690d539?format=JSON&size=1000",
} as const;

export type ReservoirRegion = "north" | "central" | "south";

/** The 20 major reservoirs tracked by taiwan-reservoir-static (identifier → name, county, region). */
export const MAJOR_RESERVOIRS: ReadonlyArray<{ id: string; name: string; county: string; region: ReservoirRegion }> = [
  { id: "10201", name: "石門水庫", county: "桃園市", region: "north" },
  { id: "10204", name: "新山水庫", county: "基隆市", region: "north" },
  { id: "10205", name: "翡翠水庫", county: "新北市", region: "north" },
  { id: "10401", name: "寶山水庫", county: "新竹縣", region: "north" },
  { id: "10405", name: "寶山第二水庫", county: "新竹縣", region: "north" },
  { id: "10501", name: "永和山水庫", county: "苗栗縣", region: "central" },
  { id: "10601", name: "明德水庫", county: "苗栗縣", region: "central" },
  { id: "20101", name: "鯉魚潭水庫", county: "苗栗縣", region: "central" },
  { id: "20201", name: "德基水庫", county: "臺中市", region: "central" },
  { id: "20501", name: "霧社水庫", county: "南投縣", region: "central" },
  { id: "20502", name: "日月潭水庫", county: "南投縣", region: "central" },
  { id: "20509", name: "湖山水庫", county: "雲林縣", region: "central" },
  { id: "30301", name: "仁義潭水庫", county: "嘉義縣", region: "south" },
  { id: "30302", name: "蘭潭水庫", county: "嘉義市", region: "south" },
  { id: "30401", name: "白河水庫", county: "臺南市", region: "south" },
  { id: "30501", name: "烏山頭水庫", county: "臺南市", region: "south" },
  { id: "30502", name: "曾文水庫", county: "臺南市", region: "south" },
  { id: "30503", name: "南化水庫", county: "臺南市", region: "south" },
  { id: "30802", name: "阿公店水庫", county: "高雄市", region: "south" },
  { id: "31201", name: "牡丹水庫", county: "屏東縣", region: "south" },
];

export interface Reservoir {
  id: string;
  name: string;
  county: string;
  region: ReservoirRegion;
  /** Effective capacity and effective storage, 10,000 m³ (萬立方公尺), as published. */
  capacity: number;
  storage: number;
  /** storage / capacity × 100, one decimal; may exceed 100 when the reservoir is above its normal level. */
  percent: number;
  observedAt: string;
}

export interface ReservoirData {
  reservoirs: Reservoir[];
}

/** At least half of the 20 must be present (same floor as taiwan-reservoir-static). */
export const RESERVOIR_MIN_COUNT = 10;
/** Rows older than this are dropped (some reservoirs report once a day). */
export const RESERVOIR_MAX_AGE_HOURS = 48;
const FUTURE_TOLERANCE_MS = 15 * 60_000;

const rowsOf = (payload: unknown): unknown[] => {
  if (Array.isArray(payload)) return payload;
  const r = asRecord(payload);
  if (Array.isArray(r.records)) return r.records;
  throw new ValidationError("reservoir", "回應不是陣列");
};

export const parseReservoirs = (realtime: unknown, daily: unknown, now: number): { data: ReservoirData; issues: string[] } => {
  const issues: string[] = [];
  const capacities = new Map<string, number>();
  for (const raw of rowsOf(daily)) {
    const row = asRecord(raw);
    const id = toText(row.reservoiridentifier);
    const capacity = toNumber(row.capacity);
    if (id && capacity !== undefined && capacity > 0) capacities.set(id, capacity);
  }

  // Several rows per reservoir; keep the newest one that is not in the future.
  // (Some reservoirs publish rows hours ahead of now — observed 2026-10-16 — those are discarded.)
  const latest = new Map<string, { at: number; storage: number }>();
  let future = 0;
  for (const raw of rowsOf(realtime)) {
    const row = asRecord(raw);
    const id = toText(row.reservoiridentifier);
    const at = parseOfficialTime(row.observationtime);
    const storage = toNumber(row.effectivewaterstoragecapacity);
    if (!id || at === undefined || storage === undefined || storage < 0) continue;
    if (at - now > FUTURE_TOLERANCE_MS) {
      future += 1;
      continue;
    }
    const prev = latest.get(id);
    if (!prev || at > prev.at) latest.set(id, { at, storage });
  }
  if (future) issues.push(`略過 ${future} 筆觀測時間在未來的資料`);

  const reservoirs: Reservoir[] = [];
  const missing: string[] = [];
  for (const meta of MAJOR_RESERVOIRS) {
    const reading = latest.get(meta.id);
    const capacity = capacities.get(meta.id);
    if (!reading || !capacity || now - reading.at > RESERVOIR_MAX_AGE_HOURS * 3_600_000) {
      missing.push(meta.name);
      continue;
    }
    reservoirs.push({ ...meta, capacity, storage: reading.storage, percent: Math.round((reading.storage / capacity) * 1000) / 10, observedAt: toIso(reading.at)! });
  }
  if (missing.length) issues.push(`缺少或過舊（超過 ${RESERVOIR_MAX_AGE_HOURS} 小時）：${missing.join("、")}`);
  if (reservoirs.length < RESERVOIR_MIN_COUNT) throw new ValidationError("reservoir", `有效水庫 ${reservoirs.length} 座，少於 ${RESERVOIR_MIN_COUNT}`);
  return { data: { reservoirs }, issues };
};

/** Newest observation among the reservoirs — the feed's sourceTime. Each reservoir also carries its own. */
export const newestReservoirObservation = (data: ReservoirData): string | null => {
  const times = data.reservoirs.map((r) => Date.parse(r.observedAt));
  return times.length ? toIso(Math.max(...times)) : null;
};

export const isReservoirData = (value: unknown): value is ReservoirData =>
  isRecord(value) &&
  Array.isArray(value.reservoirs) &&
  value.reservoirs.every((r) => isRecord(r) && typeof r.id === "string" && typeof r.percent === "number" && typeof r.observedAt === "string");
