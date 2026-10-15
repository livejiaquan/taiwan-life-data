import { findTown, normalizeCountyName, townsOf, type Town } from "@taiwan-life-data/contract";

const STORAGE_KEY = "tld:place";
const DEFAULT = { county: "臺北市", town: "中正區" };

const fromStorage = (): Town | undefined => {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as { county?: string; town?: string } | null;
    return saved ? findTown(saved.county, saved.town) : undefined;
  } catch {
    return undefined;
  }
};

/**
 * URL first (?county=&town=, shareable), then the last place used on this device,
 * then 臺北市中正區. `?county=` alone (phase-1 links) picks the county's first township.
 */
export const readPlace = (search: string): Town => {
  const params = new URLSearchParams(search);
  const fromUrl = findTown(params.get("county"), params.get("town"));
  if (fromUrl) return fromUrl;
  const county = normalizeCountyName(params.get("county"));
  if (county) return townsOf(county)[0]!;
  return fromStorage() ?? findTown(DEFAULT.county, DEFAULT.town)!;
};

export const placeUrl = (town: Town, base = typeof location === "undefined" ? "https://livejiaquan.github.io/taiwan-life-data/" : location.href): string => {
  const url = new URL(base);
  url.search = "";
  url.hash = "";
  url.searchParams.set("county", town.county);
  url.searchParams.set("town", town.town);
  return url.toString();
};

export const savePlace = (town: Town) => {
  history.replaceState(null, "", placeUrl(town));
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ county: town.county, town: town.town }));
  } catch {
    // Private mode: the URL still carries the place.
  }
};
