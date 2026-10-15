import { computeProfile, type FeedDataMap } from "@taiwan-life-data/collectors";
import { describe, expect, it } from "vitest";
import { assessPower, reservoirRows, windowText } from "../src/today";

/** flatProfile ends 2026-10-03 23:00 +08; this is within its 3-day window. */
const NOW = Date.parse("2026-10-04T12:10:00+08:00");
const power = (lifecycle: number, observedAt = "2026-10-04T04:00:00.000Z"): FeedDataMap["power"] => ({
  observedAt,
  categories: [],
  generationMw: 30000,
  intensity: { lifecycle, direct: 400, basisMw: 30000 },
  factorsVersion: "test",
  lowCarbonPercent: 20,
  renewablePercent: 18,
  load: null,
});

const flatProfile = (g: number) =>
  computeProfile(
    Array.from({ length: 72 }, (_, i) => ({ at: Date.parse("2026-10-01T00:00:00+08:00") + i * 3_600_000, lifecycle: g })),
    { kind: "recent", basis: "t", generatedAt: "2026-10-16T00:00:00Z" },
  );

describe("assessPower", () => {
  it("compares with the same Taipei hour of the recent profile", () => {
    const v = assessPower(power(550), flatProfile(500), NOW);
    expect(v.headline).toBe("目前每度電約 550 公克 CO₂e");
    expect(v.details[0]).toBe("比最近 14 天同一時段的平均（500 公克）高 10%");
    expect(v.tone).toBe("notice");
    expect(assessPower(power(450), flatProfile(500), NOW).tone).toBe("ok");
  });

  it("makes no comparison from an insufficient profile", () => {
    const thin = computeProfile([{ at: 0, lifecycle: 100 }], { kind: "recent", basis: "t", generatedAt: "" });
    expect(assessPower(power(550), thin, NOW).details.join()).not.toMatch(/最近 14 天/);
    expect(assessPower(power(550), null, NOW).details.join()).not.toMatch(/最近 14 天/);
  });
});

describe("staleness inside the power card", () => {
  it("ignores a profile whose newest sample is over 3 days old", () => {
    // flatProfile ends 2026-10-03 23:00 +08.
    expect(assessPower(power(550), flatProfile(500), Date.parse("2026-10-07T12:00:00+08:00")).details.join()).not.toMatch(/最近 14 天/);
  });

  it("drops the load line when the load file is older than 90 minutes", () => {
    const load = { currentMw: 27000, reservePercent: 12, indicator: "G" as const, publishedAt: "2026-10-04T01:00:00.000Z" };
    expect(assessPower({ ...power(550), load }, null, Date.parse("2026-10-04T02:00:00Z")).details.join()).toMatch(/目前負載/);
    expect(assessPower({ ...power(550), load }, null, Date.parse("2026-10-04T03:00:00Z")).details.join()).not.toMatch(/目前負載/);
  });
});

describe("reservoirRows", () => {
  it("groups by region and hides readings older than 48 hours", () => {
    const now = Date.parse("2026-10-18T12:00:00+08:00");
    const base = { county: "臺南市", capacity: 100, storage: 50, percent: 50 };
    const rows = reservoirRows(
      {
        reservoirs: [
          { ...base, id: "a", name: "新", region: "south", observedAt: "2026-10-18T10:00:00+08:00" },
          { ...base, id: "b", name: "舊", region: "south", observedAt: "2026-10-16T10:00:00+08:00" },
        ],
      },
      now,
    );
    expect(rows.south.map((r) => [r.name, r.fresh])).toEqual([["新", true], ["舊", false]]);
    expect(rows.north).toEqual([]);
  });
});

it("formats hour windows, wrapping past midnight", () => {
  expect(windowText({ startHour: 22, endHour: 1, lifecycle: 0 })).toBe("22:00–01:00");
});
