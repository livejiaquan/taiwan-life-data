import { describe, expect, it } from "vitest";
import type { FeedDataMap } from "@taiwan-life-data/collectors";
import { COUNTIES, findTown, TOWNS, townsOf } from "@taiwan-life-data/contract";
import { assessAqi, assessHeat, assessRain, assessUv, assessWarnings, summarize } from "./assess";
import { readPlace } from "./place";
import { buildShareText, lineShareUrl } from "./share";

const NOW = Date.parse("2026-10-16T13:00:00+08:00");
const annan = findTown("臺南市", "安南區")!;
const tainanEast = findTown("臺南市", "東區")!;
const county = (name: string, hazards: FeedDataMap["warnings"]["counties"][number]["hazards"] = []) => ({ county: name, geocode: "63", hazards });

describe("assessments (township level)", () => {
  it("warnings: county-issued, only active hazards count", () => {
    const data = { sent: "", counties: [county("臺南市", [
      { phenomena: "大雨", significance: "特報", startTime: "2026-10-16T03:00:00Z", endTime: "2026-10-16T09:00:00Z", affectedAreas: ["山區"] },
      { phenomena: "陸上強風", significance: "特報", startTime: "2026-10-15T00:00:00Z", endTime: "2026-10-15T06:00:00Z", affectedAreas: [] },
    ])] };
    const verdict = assessWarnings(data, annan, NOW);
    expect(verdict).toMatchObject({ tone: "danger", headline: "大雨特報" });
    expect(verdict.details[0]).toContain("山區");
    expect(assessWarnings(data, findTown("臺北市", "中正區")!, NOW).tone).toBe("ok");
  });

  it("heat: the township's own current slot decides the headline", () => {
    const data = { issuedAt: "", towns: [
      { county: "臺南市", town: "安南區", geocode: annan.geocode, points: [{ time: "2026-10-16T03:00:00Z", index: 31, warning: "警戒" as const }, { time: "2026-10-16T06:00:00Z", index: 33, warning: "危險" as const }] },
      { county: "臺南市", town: "東區", geocode: tainanEast.geocode, points: [{ time: "2026-10-16T03:00:00Z", index: 25, warning: null }] },
    ] };
    expect(assessHeat(data, annan, NOW)).toMatchObject({ tone: "warn", headline: "熱傷害「警戒」" });
    expect(assessHeat(data, annan, NOW).details.join()).toContain("危險");
    expect(assessHeat(data, tainanEast, NOW)).toMatchObject({ tone: "ok", headline: "現在沒有熱傷害警示" });
    expect(assessHeat(data, findTown("臺南市", "新營區")!, NOW).tone).toBe("unknown");
    const blank = { issuedAt: "", towns: [{ ...data.towns[1]!, points: [{ time: "2026-10-16T03:00:00Z", index: null, warning: null }, { time: "2026-10-16T06:00:00Z", index: 30, warning: "注意" as const }] }] };
    expect(assessHeat(blank, tainanEast, NOW)).toMatchObject({ tone: "unknown", headline: "官方預報這個時段沒有數值，不做判斷" });
  });

  it("uv: nearest UV station in the county with distance; temperature prefers the same township", () => {
    const base = { observedAt: "2026-10-16T04:00:00Z", humidity: 60 };
    const data = { stations: [
      { ...base, id: "1", name: "臺南", county: "臺南市", town: "南區", townCode: "67000330", lat: 22.99, lon: 120.2, uvIndex: 9, temperature: 31 },
      { ...base, id: "2", name: "七股", county: "臺南市", town: "七股區", townCode: "67000250", lat: 23.15, lon: 120.1, uvIndex: 3, temperature: 29 },
      { ...base, id: "3", name: "安南", county: "臺南市", town: "安南區", townCode: annan.geocode, lat: 23.05, lon: 120.18, uvIndex: null, temperature: 30.5 },
    ] };
    const v = assessUv(data, annan, NOW);
    expect(v.headline).toBe("紫外線 9（過量級）");
    expect(v.details[0]).toMatch(/^臺南測站（約 \d+ 公里）/);
    expect(v.details[1]).toContain("氣溫 30.5°C（安南測站");
    expect(assessUv(data, findTown("嘉義市", "東區")!, NOW)).toMatchObject({ tone: "unknown", headline: "本縣市沒有近期的紫外線觀測，不推估" });
    // A station that stopped reporting is skipped even though the feed is live overall.
    const stale = { stations: data.stations.map((s) => (s.id === "1" ? { ...s, observedAt: "2026-10-15T04:00:00Z" } : s)) };
    expect(assessUv(stale, annan, NOW).headline).toBe("紫外線 3（中量級）");
  });

  it("aqi: nearest station in the county, with the county maximum for context", () => {
    const station = (name: string, aqi: number, lat: number, lon: number, publishTime = "2026-10-16T04:00:00Z") => ({ siteId: name, name, county: "臺南市", aqi, status: aqi > 100 ? "對敏感族群不健康" : "普通", pollutant: null, pm25: 20, pm10: null, o3_8hr: null, publishTime, lat, lon });
    const data = { stations: [station("安南", 80, 23.048, 120.217), station("新營", 120, 23.306, 120.317)] };
    const v = assessAqi(data, annan, NOW);
    expect(v).toMatchObject({ tone: "notice", headline: "AQI 80（普通）", quiet: true });
    expect(v.details).toEqual([expect.stringMatching(/^最近測站：安南/), "臺南市 2 站中最高：新營 120"]);
    const old = { stations: [station("安南", 20, 23.048, 120.217, "2026-10-15T04:00:00Z")] };
    expect(assessAqi(old, annan, NOW)).toMatchObject({ tone: "unknown", headline: "本縣市沒有近期的空品觀測，不做判斷" });
  });

  it("rain: peak 3-hour PoP over the next 12 hours", () => {
    const slot = (h: string, pop: number | null, weather = "多雲") => ({ start: `2026-10-16T${h}:00:00+08:00`, pop, weather });
    const data = { issuedAt: "", towns: [{ county: "臺南市", town: "安南區", geocode: annan.geocode, slots: [slot("09", 90), slot("12", 20), slot("15", 60, "短暫雨"), slot("18", 10), slot("21", 30), slot("00", 100)] }] };
    const v = assessRain(data, annan, NOW);
    expect(v).toMatchObject({ tone: "notice", headline: "未來 12 小時降雨機率最高 60%，建議帶傘" });
    expect(v.details[0]).toBe("12時 20% 多雲・15時 60% 短暫雨・18時 10% 多雲・21時 30% 多雲");
    expect(assessRain(data, tainanEast, NOW).tone).toBe("unknown");
    const far = { issuedAt: "", towns: [{ ...data.towns[0]!, slots: [slot("09", 10), { start: "2026-10-17T15:00:00+08:00", pop: 90, weather: "雨" }] }] };
    expect(assessRain(far, annan, NOW).tone).toBe("unknown");
  });

  it("summary flags the riskiest items and never calls unknown items safe", () => {
    const v = (tone: "ok" | "warn" | "unknown") => ({ tone, headline: "", details: [] });
    expect(summarize([{ label: "熱傷害", verdict: v("warn"), pending: false }, { label: "空品", verdict: v("ok"), pending: false }]).text).toBe("留意熱傷害");
    expect(summarize([{ label: "空品", verdict: v("ok"), pending: false }]).text).toBe("各項都在一般範圍，正常出門");
    expect(summarize([{ label: "空品", verdict: { ...v("warn"), tone: "notice", quiet: true }, pending: false }]).text).toBe("各項都在一般範圍，正常出門");
    expect(summarize([{ label: "空品", verdict: v("ok"), pending: false }, { label: "降雨", verdict: null, pending: false }]).text).toBe("已知項目沒有需要特別留意的；降雨無法判斷");
  });
});

describe("place selection", () => {
  it("offers all 368 townships through the county → township pickers", () => {
    const offered = COUNTIES.flatMap((c) => townsOf(c.name).map((t) => t.geocode));
    expect(new Set(offered).size).toBe(368);
    expect(offered).toEqual(TOWNS.map((t) => t.geocode));
  });

  it("reads every township from a shared URL", () => {
    for (const t of TOWNS) {
      const search = `?${new URLSearchParams({ county: t.county, town: t.town })}`;
      expect(readPlace(search)).toBe(t);
    }
  });

  it("falls back: phase-1 ?county= links, then 臺北市中正區", () => {
    expect(readPlace("?county=台南市").county).toBe("臺南市");
    expect(readPlace("?county=nowhere")).toBe(findTown("臺北市", "中正區"));
  });
});

describe("share text", () => {
  it("carries place, every item's status and data time, and the link", () => {
    const text = buildShareText({
      place: "臺南市安南區",
      summary: "留意熱傷害",
      now: NOW,
      url: "https://livejiaquan.github.io/taiwan-life-data/?county=%E8%87%BA%E5%8D%97%E5%B8%82&town=%E5%AE%89%E5%8D%97%E5%8D%80",
      items: [
        { label: "熱傷害指數", status: "live", tone: "warn", text: "熱傷害「警戒」", dataTime: "2026-10-16T03:00:54.000Z" },
        { label: "空氣品質指標", status: "stale", tone: "unknown", text: "資料過舊，不做判斷。", dataTime: "2026-10-16T00:00:00.000Z" },
      ],
    });
    expect(text.split("\n")).toEqual([
      "【出門前｜臺南市安南區】10/16 13:00",
      "留意熱傷害",
      "・熱傷害指數：熱傷害「警戒」［即時，資料 10/16 11:00］",
      "・空氣品質指標：資料過舊，不做判斷。［過舊，資料 10/16 08:00］",
      "資料：中央氣象署、環境部開放資料；過舊不下結論",
      "https://livejiaquan.github.io/taiwan-life-data/?county=臺南市&town=安南區",
    ]);
    expect(lineShareUrl("a b")).toBe("https://line.me/R/share?text=a%20b");
  });
});
