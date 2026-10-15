import { readFileSync } from "node:fs";
import { createEnvelope, type FeedEnvelope } from "@taiwan-life-data/contract";
import { describe, expect, it } from "vitest";
import {
  appendSample,
  computeProfile,
  parseGeneration,
  parseHeat,
  parseRainCounty,
  parseReservoirs,
  parseWarnings,
  splitRetention,
  taipeiDate,
  trimHeat,
  type ArchiveDay,
  type IntensityPoint,
  type PowerData,
} from "../src/index";

const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
const NOW = Date.parse("2026-10-16T01:40:00+08:00");

const powerEnvelope = (observedAt: string, retrievedAt = NOW): FeedEnvelope<PowerData> => {
  const g = parseGeneration(fixture("taipower-d006001.json"), NOW);
  return createEnvelope("power", { sourceTime: observedAt, data: { ...g, observedAt, load: null } }, retrievedAt);
};

describe("archive day files", () => {
  it("files samples by Taipei date of the official time and skips repeats of the same update", () => {
    // 2026-10-15T17:30Z is 10/16 01:30 in Taipei.
    const first = appendSample(null, powerEnvelope("2026-10-15T17:30:00.000Z"))!;
    expect(first.day.date).toBe("2026-10-16");
    expect(first.added).toBe(true);
    const again = appendSample(first.day, powerEnvelope("2026-10-15T17:30:00.000Z", NOW + 600_000))!;
    expect(again.added).toBe(false);
    const next = appendSample(first.day, powerEnvelope("2026-10-15T17:40:00.000Z", NOW + 600_000))!;
    expect(next.added).toBe(true);
    expect(next.day.samples.map((s) => s.sourceTime)).toEqual(["2026-10-15T17:30:00.000Z", "2026-10-15T17:40:00.000Z"]);
    // A sample from another day must not land in this file.
    expect(() => appendSample(first.day, powerEnvelope("2026-10-14T10:00:00.000Z"))).toThrow(/written to/);
  });

  it("keeps a changed snapshot even when sourceTime is unchanged (late station)", () => {
    const { data } = parseReservoirs(fixture("wra-realtime.json"), fixture("wra-daily.json"), NOW);
    const env = (d: typeof data) => createEnvelope("reservoir", { sourceTime: "2026-10-15T17:00:00.000Z", data: d }, NOW);
    const first = appendSample(null, env(data))!;
    expect(appendSample(first.day, env(data))!.added).toBe(false);
    const later = { reservoirs: data.reservoirs.map((r) => (r.name === "新山水庫" ? { ...r, percent: 86, observedAt: "2026-10-16T07:00:00+08:00" } : r)) };
    expect(appendSample(first.day, env(later))!.added).toBe(true);
  });

  it("does not archive unavailable snapshots", () => {
    expect(appendSample(null, createEnvelope<PowerData>("power", { sourceTime: null, data: null }, NOW))).toBeNull();
  });

  it("files warnings by retrieval time and only records changes", () => {
    const data = parseWarnings(fixture("W-C0033-001.json"));
    const env = (at: number) => createEnvelope("warnings", { sourceTime: data.sent, data }, at);
    const a = appendSample(null, env(NOW))!;
    expect(a.day.date).toBe("2026-10-16");
    expect(appendSample(a.day, env(NOW + 3_600_000))!.added).toBe(false);
    const changed = createEnvelope("warnings", { sourceTime: data.sent, data: { ...data, counties: data.counties.slice(1) } }, NOW + 7_200_000);
    expect(appendSample(a.day, changed)!.added).toBe(true);
  });

  it("compacts forecasts to a shared time axis per township", () => {
    const heat = trimHeat(parseHeat(fixture("M-A0085-001.json"), 1), NOW);
    const day = appendSample(null, createEnvelope("heat", { sourceTime: heat.issuedAt, data: heat }, NOW))!.day;
    const compact = day.samples[0]!.data as { issuedAt: string; table: { columns: string[]; rows: unknown[][] } };
    expect(compact.table.rows).toHaveLength(heat.towns.length);
    expect(compact.table.columns[0]).toBe("geocode");
    expect(compact.table.rows[0]![0]).toBe(heat.towns[0]!.geocode);
    expect(compact.table.rows[0]!.length).toBe(compact.table.columns.length);

    const rain = parseRainCounty(fixture("F-D0047-001.json"), "宜蘭縣");
    const rainDay = appendSample(null, createEnvelope("rain", { sourceTime: rain.issuedAt, data: { issuedAt: rain.issuedAt, towns: rain.towns } }, NOW))!.day;
    expect((rainDay.samples[0]!.data as { table: { rows: unknown[] } }).table.rows).toHaveLength(12);

    const { data } = parseReservoirs(fixture("wra-realtime.json"), fixture("wra-daily.json"), NOW);
    const resDay: ArchiveDay = appendSample(null, createEnvelope("reservoir", { sourceTime: "2026-10-15T17:00:00.000Z", data }, NOW))!.day;
    expect((resDay.samples[0]!.data as { rows: unknown[] }).rows).toHaveLength(20);
  });

  it("keeps the last 90 Taipei days", () => {
    expect(taipeiDate(Date.parse("2026-10-15T16:00:00Z"))).toBe("2026-10-16");
    // 2026-07-19 … 2026-10-16 is exactly 90 days.
    const dates = ["2026-07-17", "2026-07-18", "2026-10-16", "2026-07-19"];
    expect(splitRetention(dates, "2026-10-16")).toEqual({ keep: ["2026-07-19", "2026-10-16"], drop: ["2026-07-17", "2026-07-18"] });
  });
});

describe("綠電時段 profile", () => {
  const meta = { kind: "recent" as const, basis: "test", generatedAt: "2026-10-16T00:00:00Z" };
  const day = Date.parse("2026-10-01T00:00:00+08:00");
  /** Solar-shaped day: 600 g at night, 400 g from 11:00 to 14:00. */
  const points = (days: number, hours = 24): IntensityPoint[] =>
    Array.from({ length: days }, (_, d) => Array.from({ length: hours }, (_, h) => ({ at: day + d * 86_400_000 + h * 3_600_000, lifecycle: h >= 11 && h < 14 ? 400 : h >= 18 && h < 21 ? 650 : 600 }))).flat();

  it("finds the cleanest and dirtiest 3-hour windows in Taipei hours", () => {
    const p = computeProfile(points(3), meta);
    expect(p.insufficient).toBeNull();
    expect(p.greenest).toEqual({ startHour: 11, endHour: 14, lifecycle: 400 });
    expect(p.dirtiest).toEqual({ startHour: 18, endHour: 21, lifecycle: 650 });
    expect(p.hours[12]).toEqual({ hour: 12, n: 3, lifecycle: 400 });
  });

  it("refuses to name a window from too few samples or hours", () => {
    expect(computeProfile(points(1), meta).insufficient).toMatch(/少於 48/);
    expect(computeProfile(points(5, 12), meta).insufficient).toMatch(/12 個小時/);
    expect(computeProfile(points(5, 12), meta).greenest).toBeNull();
  });
});
