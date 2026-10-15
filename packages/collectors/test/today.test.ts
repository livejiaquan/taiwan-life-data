import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  carbonIntensity,
  collectFeed,
  combinePower,
  createJsonFetcher,
  fuelCategory,
  parseFeedEnvelope,
  parseGeneration,
  parseReservoirs,
  parseSupply,
  TAIPOWER_FILES,
  WRA_FILES,
  type JsonFetcher,
} from "../src/index";

const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
const clone = <T>(value: T): T => structuredClone(value);
/** Fixtures were downloaded 2026-10-16 01:3x +08. */
const NOW = Date.parse("2026-10-16T01:40:00+08:00");

describe("carbon intensity", () => {
  it("weights factors by generation and ignores storage", () => {
    expect(carbonIntensity({ coal: 50, solar: 50 })).toEqual({ lifecycle: 433, direct: 380, basisMw: 100 });
    // Storage in either direction does not change the average.
    expect(carbonIntensity({ coal: 50, solar: 50, storage: 400, "storage-load": -300 })).toEqual(carbonIntensity({ coal: 50, solar: 50 }));
    expect(carbonIntensity({ storage: 10 })).toBeNull();
  });

  it("maps every Taipower unit type in the fixture to a known category", () => {
    const rows = (fixture("taipower-d006001.json") as { aaData: Array<Record<string, string>> }).aaData;
    const types = new Set(rows.map((r) => r["機組類型"]!));
    for (const type of types) expect(fuelCategory(type), type).not.toBe("other");
    expect(fuelCategory("民營電廠-燃煤")).toBe("coal");
    expect(fuelCategory("儲能負載(Energy Storage System Load)</b>")).toBe("storage-load");
    expect(fuelCategory("抽蓄發電")).toBe("storage");
  });
});

describe("power (Taipower d006001 + d006020)", () => {
  it("sums units by category, skipping subtotal rows", () => {
    const g = parseGeneration(fixture("taipower-d006001.json"), NOW);
    expect(g.observedAt).toBe("2026-10-15T17:30:00.000Z");
    const mw = Object.fromEntries(g.categories.map((c) => [c.category, c.mw]));
    // Matches the official 小計 rows: 燃氣 13645.8 + 民營電廠-燃氣 2025.8; 燃煤 6671.8 + 民營 1197.9.
    expect(mw.gas).toBe(15671.6);
    expect(mw.coal).toBe(7869.7);
    expect(mw.storage).toBe(771);
    expect(mw.solar).toBe(0);
    // Hand check: (7869.7·820 + 15671.6·490 + 171·650 + 924·700 + 1258·11 + 378.2·24 + 36.6·230) / 26309.1 = 567.2
    expect(g.intensity.lifecycle).toBe(567);
    expect(g.generationMw).toBe(26309.1);
    expect(g.lowCarbonPercent).toBeCloseTo(6.4, 1);
  });

  it("rejects stale shapes: future time, truncated unit list, missing values", () => {
    const future = clone(fixture("taipower-d006001.json")) as { DateTime: string };
    future.DateTime = "2026-10-16T03:00:00";
    expect(() => parseGeneration(future, NOW)).toThrow(/未來/);
    const short = clone(fixture("taipower-d006001.json")) as { aaData: unknown[] };
    short.aaData = short.aaData.slice(0, 50);
    expect(() => parseGeneration(short, NOW)).toThrow(/少於/);
    const blank = clone(fixture("taipower-d006001.json")) as { aaData: Array<Record<string, string>> };
    blank.aaData.forEach((r, i) => i % 10 === 0 && (r["淨發電量(MW)"] = "N/A"));
    expect(() => parseGeneration(blank, NOW)).toThrow(/比例/);
  });

  it("reads load and the official light, and cross-checks it against generation", () => {
    const load = parseSupply(fixture("taipower-d006020.json"), NOW);
    expect(load).toEqual({ currentMw: 27073, reservePercent: 17.2, indicator: "G", publishedAt: "2026-10-15T17:30:00.000Z" });
    const g = parseGeneration(fixture("taipower-d006001.json"), NOW);
    expect(combinePower(g, load).issues).toEqual([]);
    const off = combinePower(g, { ...load, currentMw: 40_000 });
    expect(off.data.load).toBeNull();
    expect(off.issues[0]).toMatch(/10%/);
  });

  it("collects a valid envelope, and keeps generation when only the supply file fails", async () => {
    const fetchJson: JsonFetcher = async (url) => {
      if (url === TAIPOWER_FILES.generation) return fixture("taipower-d006001.json");
      throw new Error("台電 HTTP 503");
    };
    const env = await collectFeed("power", { fetchJson, now: () => NOW });
    expect(env.status).toBe("live");
    expect(env.data?.load).toBeNull();
    expect(env.issues[0]).toMatch(/今日系統供需狀況/);
    expect(() => parseFeedEnvelope("power", JSON.parse(JSON.stringify(env)))).not.toThrow();
  });

  it("strips the UTF-8 BOM Taipower prepends", async () => {
    const body = `\ufeff${JSON.stringify({ ok: 1 })}`;
    const fetchJson = createJsonFetcher("t", 1000, async () => new Response(body));
    await expect(fetchJson("x")).resolves.toEqual({ ok: 1 });
  });
});

describe("reservoir (WRA 45501 + 41568)", () => {
  it("takes each reservoir's newest non-future reading and divides by effective capacity", () => {
    const { data, issues } = parseReservoirs(fixture("wra-realtime.json"), fixture("wra-daily.json"), NOW);
    expect(data.reservoirs).toHaveLength(20);
    const shimen = data.reservoirs.find((r) => r.name === "石門水庫")!;
    expect(shimen).toMatchObject({ capacity: 20526, storage: 19335.37, percent: 94.2, observedAt: "2026-10-15T17:00:00.000Z", county: "桃園市" });
    // Above normal level is reported as published, not clamped.
    expect(data.reservoirs.find((r) => r.name === "阿公店水庫")!.percent).toBe(131.5);
    expect(issues.join()).toMatch(/略過 13 筆觀測時間在未來/);
  });

  it("drops readings older than 48 hours and fails under 10 reservoirs", () => {
    const later = NOW + 40 * 3_600_000;
    const { data, issues } = parseReservoirs(fixture("wra-realtime.json"), fixture("wra-daily.json"), later);
    // Reservoirs that last reported at 2026-10-15 07:00/08:00 are now > 48 h old.
    expect(data.reservoirs.length).toBeLessThan(20);
    expect(issues.join()).toMatch(/仁義潭水庫/);
    expect(() => parseReservoirs(fixture("wra-realtime.json"), fixture("wra-daily.json"), NOW + 60 * 3_600_000)).toThrow(/少於 10/);
  });

  it("collects from both endpoints into an envelope", async () => {
    const fetchJson: JsonFetcher = async (url) => fixture(url === WRA_FILES.realtime ? "wra-realtime.json" : "wra-daily.json");
    const env = await collectFeed("reservoir", { fetchJson, now: () => NOW, via: "browser" });
    expect(env.sourceTime).toBe("2026-10-15T17:00:00.000Z");
    expect(env.status).toBe("live");
    expect(() => parseFeedEnvelope("reservoir", JSON.parse(JSON.stringify(env)))).not.toThrow();
  });
});
