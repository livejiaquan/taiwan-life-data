import { normalizeCountyName, parseOfficialTime, toIso } from "@taiwan-life-data/contract";
import { asArray, asRecord, boundedNumber, isRecord, toText, ValidationError } from "./parse";

export interface UvStation {
  id: string;
  name: string;
  county: string;
  town: string | null;
  /** Township geocode (TownCode); absent in snapshots made before phase 2. */
  townCode?: string | null;
  lat?: number | null;
  lon?: number | null;
  observedAt: string;
  uvIndex: number | null;
  temperature: number | null;
  humidity: number | null;
}

export interface UvData {
  stations: UvStation[];
}

export interface UvValidation {
  /** Minimum stations that report a UV index (production: ~30 of ~360 stations do). */
  minUvStations: number;
  /** Minimum counties with at least one temperature reading. */
  minCounties: number;
}

export const UV_PRODUCTION_RULES: UvValidation = { minUvStations: 20, minCounties: 20 };

/** O-A0003-001 (ported from taiwan-uv-heat-dashboard `parseObservationPayload`). */
export const parseUvObservations = (payload: unknown, rules: UvValidation = UV_PRODUCTION_RULES): UvData => {
  const dataset = asRecord(asRecord(asRecord(payload).cwaopendata).dataset);
  const stations = asArray(dataset.Station)
    .map((raw): UvStation | undefined => {
      const record = asRecord(raw);
      const geo = asRecord(record.GeoInfo);
      const weather = asRecord(record.WeatherElement);
      const county = normalizeCountyName(geo.CountyName);
      const observed = parseOfficialTime(asRecord(record.ObsTime).DateTime);
      const id = toText(record.StationId);
      if (!county || observed === undefined || !id) return undefined;
      const wgs84 = asRecord(asArray(geo.Coordinates).find((c) => asRecord(c).CoordinateName === "WGS84"));
      const station: UvStation = {
        id,
        name: toText(record.StationName) ?? id,
        county,
        town: toText(geo.TownName) ?? null,
        townCode: toText(geo.TownCode) ?? null,
        lat: boundedNumber(wgs84.StationLatitude, 21, 27) ?? null,
        lon: boundedNumber(wgs84.StationLongitude, 118, 123) ?? null,
        observedAt: toIso(observed)!,
        uvIndex: boundedNumber(weather.UVIndex, 0, 30) ?? null,
        temperature: boundedNumber(weather.AirTemperature, -50, 60) ?? null,
        humidity: boundedNumber(weather.RelativeHumidity, 0, 100) ?? null,
      };
      return station.uvIndex === null && station.temperature === null ? undefined : station;
    })
    .filter((s): s is UvStation => s !== undefined);

  const uvCount = stations.filter((s) => s.uvIndex !== null).length;
  if (uvCount < rules.minUvStations) throw new ValidationError("uv", `紫外線測站 ${uvCount} 站，少於 ${rules.minUvStations}`);
  const counties = new Set(stations.filter((s) => s.temperature !== null).map((s) => s.county)).size;
  if (counties < rules.minCounties) throw new ValidationError("uv", `有氣溫的縣市 ${counties} 個，少於 ${rules.minCounties}`);
  return { stations };
};

export const newestObservation = (data: UvData): string | null => {
  let newest: number | undefined;
  for (const s of data.stations) {
    const t = Date.parse(s.observedAt);
    if (newest === undefined || t > newest) newest = t;
  }
  return toIso(newest);
};

export const isUvData = (value: unknown): value is UvData =>
  isRecord(value) && Array.isArray(value.stations) && value.stations.every((s) => isRecord(s) && typeof s.county === "string" && typeof s.observedAt === "string");
