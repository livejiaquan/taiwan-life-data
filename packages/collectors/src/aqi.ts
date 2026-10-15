import { COUNTIES, normalizeCountyName, parseOfficialTime, toIso } from "@taiwan-life-data/contract";
import { asRecord, boundedNumber, isRecord, toText, ValidationError } from "./parse";

export interface AqiStation {
  siteId: string;
  name: string;
  county: string;
  aqi: number;
  /** Official category text, e.g. 良好 / 普通 / 對敏感族群不健康. */
  status: string;
  pollutant: string | null;
  pm25: number | null;
  pm10: number | null;
  o3_8hr: number | null;
  publishTime: string;
  /** Absent in snapshots made before phase 2. */
  lat?: number | null;
  lon?: number | null;
}

export interface AqiData {
  stations: AqiStation[];
}

export interface AqiValidation {
  minRecords: number;
  minCounties: number;
  minValidRatio: number;
  futureToleranceMinutes: number;
}

/** Same thresholds as taiwan-aqi-dashboard's production cache contract. */
export const AQI_PRODUCTION_RULES: AqiValidation = { minRecords: 80, minCounties: COUNTIES.length, minValidRatio: 0.95, futureToleranceMinutes: 15 };

const extractRows = (payload: unknown): unknown[] | null => {
  if (Array.isArray(payload)) return payload;
  const record = asRecord(payload);
  if (Array.isArray(record.records)) return record.records;
  if (Array.isArray(asRecord(record.result).records)) return asRecord(record.result).records as unknown[];
  return null;
};

/** AQX_P_432 (validation ported from taiwan-aqi-dashboard `validateAqiPayload`). */
export const parseAqi = (payload: unknown, now: number, rules: AqiValidation = AQI_PRODUCTION_RULES): AqiData => {
  const rows = extractRows(payload);
  if (!rows) throw new ValidationError("aqi", "回應沒有 records 陣列");
  const seen = new Set<string>();
  const stations: AqiStation[] = [];
  for (const raw of rows) {
    const row = asRecord(raw);
    const siteId = toText(row.siteid);
    const name = toText(row.sitename);
    const county = normalizeCountyName(row.county);
    const aqiText = toText(row.aqi);
    const publish = parseOfficialTime(row.publishtime);
    if (!siteId || !name || !county || !aqiText || !/^\d+$/.test(aqiText) || publish === undefined) continue;
    const aqi = Number(aqiText);
    if (aqi > 500) continue;
    if (publish - now > rules.futureToleranceMinutes * 60_000) continue;
    if (seen.has(siteId)) throw new ValidationError("aqi", `測站代碼重複 ${siteId}`);
    seen.add(siteId);
    stations.push({
      siteId,
      name,
      county,
      aqi,
      status: toText(row.status) ?? "",
      pollutant: toText(row.pollutant) ?? null,
      pm25: boundedNumber(row["pm2.5"], 0, 1000) ?? null,
      pm10: boundedNumber(row.pm10, 0, 2000) ?? null,
      o3_8hr: boundedNumber(row.o3_8hr, 0, 1000) ?? null,
      publishTime: toIso(publish)!,
      lat: boundedNumber(row.latitude, 21, 27) ?? null,
      lon: boundedNumber(row.longitude, 118, 123) ?? null,
    });
  }
  if (stations.length < rules.minRecords) throw new ValidationError("aqi", `有效測站 ${stations.length}，少於 ${rules.minRecords}`);
  const counties = new Set(stations.map((s) => s.county)).size;
  if (counties < rules.minCounties) throw new ValidationError("aqi", `涵蓋縣市 ${counties}，少於 ${rules.minCounties}`);
  if (stations.length / rows.length < rules.minValidRatio) throw new ValidationError("aqi", `有效比例 ${(stations.length / rows.length).toFixed(2)} 過低`);
  return { stations };
};

export const newestPublishTime = (data: AqiData): string | null => {
  const times = data.stations.map((s) => Date.parse(s.publishTime));
  return times.length ? toIso(Math.max(...times)) : null;
};

export const isAqiData = (value: unknown): value is AqiData =>
  isRecord(value) && Array.isArray(value.stations) && value.stations.every((s) => isRecord(s) && typeof s.aqi === "number" && typeof s.county === "string");
