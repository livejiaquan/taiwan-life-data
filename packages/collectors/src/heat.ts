import { normalizeCountyName, parseOfficialTime, toIso } from "@taiwan-life-data/contract";
import { asArray, asRecord, boundedNumber, isRecord, toText, ValidationError } from "./parse";

/** CWA health-weather warning levels, mildest first. */
export const HEAT_WARNINGS = ["注意", "警戒", "危險", "高危險"] as const;
export type HeatWarning = (typeof HEAT_WARNINGS)[number];

export interface HeatPoint {
  /** Start of the 3-hour forecast slot. */
  time: string;
  index: number | null;
  warning: HeatWarning | null;
}

export interface HeatTown {
  county: string;
  town: string;
  geocode: string;
  points: HeatPoint[];
}

export interface HeatData {
  issuedAt: string;
  towns: HeatTown[];
}

/** All 368 townships; anything less means a partial file. */
export const HEAT_PRODUCTION_MIN_TOWNS = 368;

/** M-A0085-001 熱傷害指數及警示全台各鄉鎮五日逐三小時預報. */
export const parseHeat = (payload: unknown, minTowns = HEAT_PRODUCTION_MIN_TOWNS): HeatData => {
  const resource = asRecord(asRecord(asRecord(asRecord(payload).cwaopendata).Resources).Resource);
  const metadata = asRecord(resource.Metadata);
  const issued = parseOfficialTime(metadata.Update) ?? parseOfficialTime(asRecord(asRecord(payload).cwaopendata).Sent);
  if (issued === undefined) throw new ValidationError("heat", "缺少發布時間");

  const towns: HeatTown[] = [];
  const seen = new Set<string>();
  for (const countyRecord of asArray(asRecord(resource.Data).Locations)) {
    const county = normalizeCountyName(asRecord(countyRecord).CountyName);
    if (!county) continue;
    for (const raw of asArray(asRecord(countyRecord).Location)) {
      const record = asRecord(raw);
      const town = toText(record.TownName);
      const geocode = toText(record.Geocode);
      if (!town || !geocode || seen.has(geocode)) continue;
      const points = asArray(record.Time)
        .map((slot): HeatPoint | undefined => {
          const t = parseOfficialTime(asRecord(slot).IssueTime);
          if (t === undefined) return undefined;
          const elements = asRecord(asRecord(slot).WeatherElements);
          const warning = toText(elements.HeatInjuryWarning);
          return {
            time: toIso(t)!,
            index: boundedNumber(elements.HeatInjuryIndex, 0, 80) ?? null,
            warning: warning && (HEAT_WARNINGS as readonly string[]).includes(warning) ? (warning as HeatWarning) : null,
          };
        })
        .filter((p): p is HeatPoint => p !== undefined)
        .sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
      if (!points.some((p) => p.index !== null)) continue;
      seen.add(geocode);
      towns.push({ county, town, geocode, points });
    }
  }
  if (towns.length < minTowns) throw new ValidationError("heat", `鄉鎮數 ${towns.length}，少於 ${minTowns}`);
  return { issuedAt: toIso(issued)!, towns };
};

/** Keeps slots from the current one onward, at most `maxPoints` (48 h by default) to keep snapshots small. */
export const trimHeat = (data: HeatData, now: number, maxPoints = 16): HeatData => ({
  issuedAt: data.issuedAt,
  towns: data.towns.map((town) => ({
    ...town,
    points: town.points.filter((p) => Date.parse(p.time) + 3 * 3_600_000 > now).slice(0, maxPoints),
  })),
});

export const isHeatData = (value: unknown): value is HeatData =>
  isRecord(value) && typeof value.issuedAt === "string" && Array.isArray(value.towns) && value.towns.every((t) => isRecord(t) && Array.isArray(t.points));
