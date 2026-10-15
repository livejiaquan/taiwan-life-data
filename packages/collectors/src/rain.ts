import { COUNTIES, normalizeCountyName, parseOfficialTime, toIso, townsOf } from "@taiwan-life-data/contract";
import { asArray, asRecord, boundedNumber, isRecord, toText, ValidationError } from "./parse";

/** F-D0047-0xx: one 3-day township forecast file per county (checked against each file's LocationsName). */
export const RAIN_FILE_CODES: Readonly<Record<string, string>> = {
  宜蘭縣: "001", 桃園市: "005", 新竹縣: "009", 苗栗縣: "013", 彰化縣: "017", 南投縣: "021", 雲林縣: "025", 嘉義縣: "029",
  屏東縣: "033", 臺東縣: "037", 花蓮縣: "041", 澎湖縣: "045", 基隆市: "049", 新竹市: "053", 嘉義市: "057", 臺北市: "061",
  高雄市: "065", 新北市: "069", 臺中市: "073", 臺南市: "077", 連江縣: "081", 金門縣: "085",
};

export const rainDatasetId = (county: string): string | undefined =>
  RAIN_FILE_CODES[county] ? `F-D0047-${RAIN_FILE_CODES[county]}` : undefined;

export interface RainSlot {
  /** Start of the 3-hour slot; the slot ends 3 hours later. */
  start: string;
  /** 3-hour probability of precipitation, %. */
  pop: number | null;
  weather: string | null;
}

export interface RainTown {
  county: string;
  town: string;
  geocode: string;
  slots: RainSlot[];
}

export interface RainData {
  /** Oldest IssueTime among the counties included (the conservative one for freshness). */
  issuedAt: string;
  towns: RainTown[];
}

const SLOT_MS = 3 * 3_600_000;

const elementSlots = (elements: unknown[], name: string) =>
  asArray(asRecord(elements.find((e) => asRecord(e).ElementName === name)).Time);

/**
 * Parses one county file. Strict: every township of the county must be present,
 * otherwise a town silently missing would look like "no forecast".
 */
export const parseRainCounty = (payload: unknown, expectedCounty: string): { issuedAt: string; towns: RainTown[] } => {
  const dataset = asRecord(asRecord(asRecord(payload).cwaopendata).Dataset);
  const issued = parseOfficialTime(asRecord(dataset.DatasetInfo).IssueTime);
  if (issued === undefined) throw new ValidationError("rain", `${expectedCounty} 缺少發布時間`);
  const locations = asRecord(dataset.Locations);
  const county = normalizeCountyName(locations.LocationsName);
  if (county !== expectedCounty) throw new ValidationError("rain", `檔案縣市 ${county ?? "?"} 與預期 ${expectedCounty} 不符`);

  const known = new Map(townsOf(county).map((t) => [t.geocode, t]));
  const towns: RainTown[] = [];
  for (const raw of asArray(locations.Location)) {
    const record = asRecord(raw);
    const geocode = toText(record.Geocode);
    const town = geocode ? known.get(geocode) : undefined;
    if (!town || towns.some((t) => t.geocode === geocode)) continue;
    const elements = asArray(record.WeatherElement);
    const weather = new Map(
      elementSlots(elements, "天氣現象").map((s) => [parseOfficialTime(asRecord(s).StartTime), toText(asRecord(asRecord(s).ElementValue).Weather) ?? null]),
    );
    const slots = elementSlots(elements, "3小時降雨機率")
      .map((s): RainSlot | undefined => {
        const start = parseOfficialTime(asRecord(s).StartTime);
        const end = parseOfficialTime(asRecord(s).EndTime);
        if (start === undefined || end === undefined || end - start !== SLOT_MS) return undefined;
        return { start: toIso(start)!, pop: boundedNumber(asRecord(asRecord(s).ElementValue).ProbabilityOfPrecipitation, 0, 100) ?? null, weather: weather.get(start) ?? null };
      })
      .filter((s): s is RainSlot => s !== undefined)
      .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
    if (!slots.some((s) => s.pop !== null)) continue;
    towns.push({ county, town: town.town, geocode: town.geocode, slots });
  }
  if (towns.length !== known.size) throw new ValidationError("rain", `${county} 鄉鎮 ${towns.length}／${known.size}`);
  return { issuedAt: toIso(issued)!, towns };
};

/** Keeps slots from the current one onward, at most `maxSlots` (24 h by default). */
export const trimRain = (data: RainData, now: number, maxSlots = 8): RainData => ({
  issuedAt: data.issuedAt,
  towns: data.towns.map((t) => ({ ...t, slots: t.slots.filter((s) => Date.parse(s.start) + SLOT_MS > now).slice(0, maxSlots) })),
});

/** Merges per-county results; issuedAt is the oldest so freshness is never overstated. */
export const mergeRain = (parts: Array<{ issuedAt: string; towns: RainTown[] }>): RainData => {
  if (!parts.length) throw new ValidationError("rain", "沒有任何縣市的預報");
  const oldest = Math.min(...parts.map((p) => Date.parse(p.issuedAt)));
  return { issuedAt: toIso(oldest)!, towns: parts.flatMap((p) => p.towns) };
};

export const RAIN_COUNTIES = COUNTIES.map((c) => c.name);

export const isRainData = (value: unknown): value is RainData =>
  isRecord(value) && typeof value.issuedAt === "string" && Array.isArray(value.towns) && value.towns.every((t) => isRecord(t) && typeof t.geocode === "string" && Array.isArray(t.slots));
