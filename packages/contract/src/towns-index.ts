import { COUNTIES, normalizeCountyName } from "./counties";
import { TOWN_ROWS } from "./towns";

export interface Town {
  county: string;
  town: string;
  /** CWA township geocode (8 digits), shared by M-A0085-001, F-D0047 and O-A0003-001 TownCode. */
  geocode: string;
  lat: number;
  lon: number;
}

/** All 368 townships, in county order then geocode order. */
export const TOWNS: readonly Town[] = TOWN_ROWS.map(([county, town, geocode, lat, lon]) => ({ county, town, geocode, lat, lon }));

const BY_COUNTY = new Map<string, Town[]>(COUNTIES.map((c) => [c.name, []]));
for (const t of TOWNS) BY_COUNTY.get(t.county)!.push(t);

export const townsOf = (county: string): readonly Town[] => BY_COUNTY.get(county) ?? [];

/** Resolves county/town names from a URL or storage ("台" is accepted for "臺"); undefined when unknown. */
export const findTown = (county: unknown, town: unknown): Town | undefined => {
  const c = normalizeCountyName(county);
  if (!c || typeof town !== "string") return undefined;
  const name = town.trim().replace(/^台/, "臺");
  return townsOf(c).find((t) => t.town === name);
};

/** Great-circle distance in km. */
export const distanceKm = (a: { lat: number; lon: number }, b: { lat: number; lon: number }): number => {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
};
