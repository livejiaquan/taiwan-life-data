import { COUNTIES, parseOfficialTime, toIso } from "@taiwan-life-data/contract";
import { asArray, isRecord, toText, ValidationError } from "./parse";

export interface Hazard {
  phenomena: string;
  significance: string;
  startTime: string;
  endTime: string;
  /** Sub-areas named by CWA (e.g. 山區); empty means the whole county. */
  affectedAreas: string[];
}

export interface CountyWarnings {
  county: string;
  geocode: string;
  hazards: Hazard[];
}

export interface WarningsData {
  /** Time CWA last (re)issued the file. */
  sent: string;
  counties: CountyWarnings[];
}

const GEOCODE_BY_COUNTY = new Map(COUNTIES.map((c) => [c.name, c.geocode]));

const parseHazard = (value: unknown): Hazard => {
  if (!isRecord(value) || !isRecord(value.info) || !isRecord(value.validTime)) throw new ValidationError("warnings", "hazard 結構不完整");
  const phenomena = toText(value.info.phenomena);
  const significance = toText(value.info.significance);
  const start = parseOfficialTime(value.validTime.startTime);
  const end = parseOfficialTime(value.validTime.endTime);
  if (!phenomena || !significance) throw new ValidationError("warnings", "hazard 缺少現象或等級");
  if (start === undefined || end === undefined || start >= end) throw new ValidationError("warnings", "hazard 有效時間無效");
  const areas = isRecord(value.hazard) && isRecord(value.hazard.info) && isRecord(value.hazard.info.affectedAreas)
    ? asArray(value.hazard.info.affectedAreas.location).map((l) => toText(isRecord(l) ? l.locationName : undefined))
    : [];
  if (areas.some((a) => a === undefined)) throw new ValidationError("warnings", "affectedAreas 缺少地名");
  return { phenomena, significance, startTime: toIso(start)!, endTime: toIso(end)!, affectedAreas: areas as string[] };
};

/**
 * W-C0033-001. Strict on purpose (ported from taiwan-weather-risk-dashboard):
 * a payload missing any county must never be read as "no warnings".
 */
export const parseWarnings = (payload: unknown): WarningsData => {
  const root = isRecord(payload) && isRecord(payload.cwaopendata) ? payload.cwaopendata : undefined;
  if (!root) throw new ValidationError("warnings", "缺少 cwaopendata");
  const sent = parseOfficialTime(root.sent);
  if (sent === undefined) throw new ValidationError("warnings", "sent 時間無效");
  if (!isRecord(root.dataset) || !("location" in root.dataset)) throw new ValidationError("warnings", "缺少 dataset.location");

  const seen = new Set<string>();
  const counties = asArray(root.dataset.location).map((location): CountyWarnings => {
    if (!isRecord(location)) throw new ValidationError("warnings", "location 不是物件");
    const county = toText(location.locationName);
    const geocode = toText(location.geocode);
    if (!county || !geocode || GEOCODE_BY_COUNTY.get(county) !== geocode) throw new ValidationError("warnings", `未知縣市 ${county ?? "?"}`);
    if (seen.has(county)) throw new ValidationError("warnings", `重複縣市 ${county}`);
    seen.add(county);
    if (!("hazardConditions" in location)) throw new ValidationError("warnings", `${county} 缺少 hazardConditions`);
    const conditions = location.hazardConditions;
    if (conditions === null) return { county, geocode, hazards: [] };
    if (!isRecord(conditions) || !("hazards" in conditions)) throw new ValidationError("warnings", `${county} hazardConditions 無效`);
    const hazards = asArray(conditions.hazards).map(parseHazard);
    if (!hazards.length) throw new ValidationError("warnings", `${county} hazards 為空`);
    return { county, geocode, hazards };
  });
  if (seen.size !== COUNTIES.length) throw new ValidationError("warnings", `縣市數 ${seen.size}，應為 ${COUNTIES.length}`);
  return { sent: toIso(sent)!, counties };
};

/** Hazards in effect at `now`; CWA keeps expired entries in the file until the next issue. */
export const activeHazards = (county: CountyWarnings | undefined, now: number): Hazard[] =>
  (county?.hazards ?? []).filter((h) => Date.parse(h.startTime) <= now && now < Date.parse(h.endTime));

export const isWarningsData = (value: unknown): value is WarningsData =>
  isRecord(value) && typeof value.sent === "string" && Array.isArray(value.counties) && value.counties.length === COUNTIES.length;
