import { describe, expect, it } from "vitest";
import type { FeedDataMap } from "@taiwan-life-data/collectors";
import { assessAqi, assessHeat, assessUv, assessWarnings } from "./assess";

const NOW = Date.parse("2026-10-16T13:00:00+08:00");
const county = (name: string, hazards: FeedDataMap["warnings"]["counties"][number]["hazards"] = []) => ({ county: name, geocode: "63", hazards });

describe("assessments", () => {
  it("warnings: only active hazards count", () => {
    const data = { sent: "", counties: [county("臺北市", [
      { phenomena: "大雨", significance: "特報", startTime: "2026-10-16T03:00:00Z", endTime: "2026-10-16T09:00:00Z", affectedAreas: ["山區"] },
      { phenomena: "陸上強風", significance: "特報", startTime: "2026-10-15T00:00:00Z", endTime: "2026-10-15T06:00:00Z", affectedAreas: [] },
    ])] };
    const verdict = assessWarnings(data, "臺北市", NOW);
    expect(verdict).toMatchObject({ tone: "danger", headline: "大雨特報" });
    expect(verdict.details[0]).toContain("山區");
    expect(assessWarnings(data, "臺南市", NOW).tone).toBe("ok");
  });

  it("heat: current slot decides the headline", () => {
    const data = { issuedAt: "", towns: [
      { county: "臺南市", town: "安南區", geocode: "6700", points: [{ time: "2026-10-16T03:00:00Z", index: 31, warning: "警戒" as const }, { time: "2026-10-16T06:00:00Z", index: 33, warning: "危險" as const }] },
    ] };
    expect(assessHeat(data, "臺南市", NOW)).toMatchObject({ tone: "warn", headline: "熱傷害「警戒」（安南區等地）" });
    expect(assessHeat(data, "臺南市", NOW).details[1]).toContain("危險");
    expect(assessHeat(data, "臺北市", NOW).tone).toBe("unknown");
  });

  it("uv: never borrows a neighbouring county's station", () => {
    const data = { stations: [{ id: "1", name: "臺南", county: "臺南市", town: null, observedAt: "2026-10-16T04:00:00Z", uvIndex: 9, temperature: 31, humidity: 60 }] };
    expect(assessUv(data, "臺南市")).toMatchObject({ tone: "danger", headline: "紫外線 9（過量級）" });
    expect(assessUv(data, "嘉義市")).toMatchObject({ tone: "unknown", headline: "本縣市沒有紫外線測站，不推估" });
  });

  it("aqi: worst station in the county", () => {
    const station = (name: string, aqi: number) => ({ siteId: name, name, county: "高雄市", aqi, status: aqi > 100 ? "對敏感族群不健康" : "普通", pollutant: null, pm25: 20, pm10: null, o3_8hr: null, publishTime: "" });
    expect(assessAqi({ stations: [station("前金", 80), station("小港", 120)] }, "高雄市")).toMatchObject({ tone: "warn", headline: "AQI 最高 120（對敏感族群不健康）" });
  });
});
