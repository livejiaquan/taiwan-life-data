import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  activeHazards,
  collectFeed,
  createJsonFetcher,
  CWA_FILES,
  cwaRainFile,
  parseAqi,
  parseFeedEnvelope,
  parseRainCounty,
  parseHeat,
  parseUvObservations,
  parseWarnings,
  trimHeat,
  type JsonFetcher,
} from "../src/index";
import { collectAqi, DATA_GOV_AQI_METADATA, resolveAqiUrl } from "../src/server";

const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
const clone = <T>(value: T): T => structuredClone(value);
const NOW = Date.parse("2026-10-16T00:20:00+08:00");
const SMALL_UV = { minUvStations: 20, minCounties: 5 };

describe("warnings (W-C0033-001)", () => {
  it("parses all 22 counties and keeps hazard windows", () => {
    const data = parseWarnings(fixture("W-C0033-001.json"));
    expect(data.counties).toHaveLength(22);
    expect(data.sent).toBe("2026-10-15T08:26:24.000Z");
    const taoyuan = data.counties.find((c) => c.county === "桃園市")!;
    expect(taoyuan.hazards[0]).toMatchObject({ phenomena: "陸上強風", significance: "特報", affectedAreas: [] });
  });

  it("filters out hazards that have already ended", () => {
    const data = parseWarnings(fixture("W-C0033-001.json"));
    const taoyuan = data.counties.find((c) => c.county === "桃園市");
    expect(activeHazards(taoyuan, Date.parse("2026-10-15T18:00:00+08:00"))).toHaveLength(1);
    expect(activeHazards(taoyuan, NOW)).toHaveLength(0);
  });

  it("refuses a payload missing a county instead of reading it as 'no warnings'", () => {
    const payload = clone(fixture("W-C0033-001.json")) as { cwaopendata: { dataset: { location: unknown[] } } };
    payload.cwaopendata.dataset.location.pop();
    expect(() => parseWarnings(payload)).toThrow(/縣市數/);
  });

  it("refuses mismatched geocodes and malformed hazards", () => {
    const payload = clone(fixture("W-C0033-001.json")) as { cwaopendata: { dataset: { location: Array<Record<string, unknown>> } } };
    payload.cwaopendata.dataset.location[0]!.geocode = "99999";
    expect(() => parseWarnings(payload)).toThrow(/未知縣市/);
    const bad = clone(fixture("W-C0033-001.json")) as { cwaopendata: { dataset: { location: Array<Record<string, unknown>> } } };
    bad.cwaopendata.dataset.location[0]!.hazardConditions = { hazards: { info: { phenomena: "大雨" }, validTime: {} } };
    expect(() => parseWarnings(bad)).toThrow(/hazard/);
  });
});

describe("uv (O-A0003-001)", () => {
  it("keeps stations with UV or temperature and normalizes times", () => {
    const data = parseUvObservations(fixture("O-A0003-001.json"), SMALL_UV);
    const keelung = data.stations.find((s) => s.id === "466940")!;
    expect(keelung).toMatchObject({ county: "基隆市", town: "仁愛區", townCode: "10017040", lat: 25.133314, lon: 121.740475, uvIndex: 0, temperature: 24.5, humidity: 84 });
    expect(keelung.observedAt).toBe("2026-10-15T16:10:00.000Z");
    expect(data.stations.filter((s) => s.uvIndex !== null)).toHaveLength(30);
  });

  it("treats -99 sentinels as missing, not as readings", () => {
    const payload = clone(fixture("O-A0003-001.json")) as { cwaopendata: { dataset: { Station: Array<{ WeatherElement: Record<string, string> }> } } };
    payload.cwaopendata.dataset.Station[0]!.WeatherElement.UVIndex = "-99";
    payload.cwaopendata.dataset.Station[0]!.WeatherElement.AirTemperature = "-99";
    const data = parseUvObservations(payload, { minUvStations: 1, minCounties: 1 });
    expect(data.stations.find((s) => s.id === "466940")).toBeUndefined();
  });

  it("refuses a file with too few UV stations", () => {
    expect(() => parseUvObservations(fixture("O-A0003-001.json"))).not.toThrow(/紫外線/);
    expect(() => parseUvObservations(fixture("O-A0003-001.json"), { minUvStations: 31, minCounties: 1 })).toThrow(/紫外線測站/);
  });
});

describe("heat (M-A0085-001)", () => {
  it("parses township forecasts including the +8:00 offset", () => {
    const data = parseHeat(fixture("M-A0085-001.json"), 6);
    expect(data.towns).toHaveLength(6);
    expect(data.issuedAt).toBe("2026-10-15T14:00:54.000Z");
    const first = data.towns[0]!;
    expect(first.geocode).toMatch(/^\d{7,8}$/);
    expect(first.points[0]!.time).toBe("2026-10-15T16:00:00.000Z");
    expect(first.points.every((p) => p.warning === null || ["注意", "警戒", "危險", "高危險"].includes(p.warning))).toBe(true);
  });

  it("refuses partial files in production", () => {
    expect(() => parseHeat(fixture("M-A0085-001.json"))).toThrow(/鄉鎮數 6/);
  });

  it("trims past slots", () => {
    const data = parseHeat(fixture("M-A0085-001.json"), 6);
    const trimmed = trimHeat(data, Date.parse("2026-10-16T07:00:00+08:00"), 4);
    expect(trimmed.towns[0]!.points.map((p) => p.time)).toEqual([
      "2026-10-15T22:00:00.000Z", // 06:00 Taiwan — the slot containing 07:00
      "2026-10-16T01:00:00.000Z",
      "2026-10-16T04:00:00.000Z",
      "2026-10-16T07:00:00.000Z",
    ]);
  });
});

describe("rain (F-D0047 township 3-day forecast)", () => {
  it("parses every township of the county with 3-hour PoP and weather", () => {
    const data = parseRainCounty(fixture("F-D0047-001.json"), "宜蘭縣");
    expect(data.issuedAt).toBe("2026-10-15T15:00:00.000Z");
    expect(data.towns).toHaveLength(12);
    expect(data.towns[0]).toMatchObject({ county: "宜蘭縣", town: "宜蘭市", geocode: "10002010" });
    expect(data.towns[0]!.slots[0]).toEqual({ start: "2026-10-15T16:00:00.000Z", pop: 30, weather: "短暫雨" });
  });

  it("refuses a file for another county or with a township missing", () => {
    expect(() => parseRainCounty(fixture("F-D0047-001.json"), "臺北市")).toThrow(/不符/);
    const payload = clone(fixture("F-D0047-001.json")) as { cwaopendata: { Dataset: { Locations: { Location: unknown[] } } } };
    payload.cwaopendata.Dataset.Locations.Location.pop();
    expect(() => parseRainCounty(payload, "宜蘭縣")).toThrow(/鄉鎮 11／12/);
  });

  it("collects only the requested counties and trims past slots", async () => {
    const envelope = await collectFeed("rain", {
      fetchJson: async (url) => {
        if (url === cwaRainFile("001")) return fixture("F-D0047-001.json");
        throw new Error("offline");
      },
      now: () => Date.parse("2026-10-16T07:00:00+08:00"),
      counties: ["宜蘭縣"],
    });
    expect(envelope.status).toBe("delayed"); // issued 23:00, read at 07:00 — 8 h old
    expect(envelope.data!.towns).toHaveLength(12);
    expect(envelope.data!.towns[0]!.slots[0]!.start).toBe("2026-10-15T22:00:00.000Z");
    expect(() => parseFeedEnvelope("rain", JSON.parse(JSON.stringify(envelope)))).not.toThrow();
  });

  it("keeps the counties that loaded and names the ones that did not", async () => {
    const envelope = await collectFeed("rain", {
      fetchJson: async (url) => (url === cwaRainFile("001") ? fixture("F-D0047-001.json") : Promise.reject(new Error("F-D0047 HTTP 503"))),
      now: () => NOW,
      counties: ["宜蘭縣", "臺北市"],
    });
    expect(envelope.data!.towns).toHaveLength(12);
    expect(envelope.issues).toEqual(["臺北市：F-D0047 HTTP 503"]);
  });
});

describe("aqi (AQX_P_432)", () => {
  it("parses all 84 stations across 22 counties", () => {
    const data = parseAqi(fixture("aqx_p_432.json"), NOW);
    expect(data.stations).toHaveLength(84);
    expect(new Set(data.stations.map((s) => s.county)).size).toBe(22);
    expect(data.stations[0]).toMatchObject({ siteId: "1", name: "基隆", county: "基隆市", aqi: 43, status: "良好", pm25: 5 });
    expect(data.stations[0]!.publishTime).toBe("2026-10-15T16:00:00.000Z");
    expect(data.stations.every((s) => typeof s.lat === "number" && typeof s.lon === "number")).toBe(true);
  });

  it("refuses duplicates, low coverage and future-dated rows", () => {
    const rows = fixture("aqx_p_432.json") as Array<Record<string, string>>;
    expect(() => parseAqi([...rows, rows[0]], NOW)).toThrow(/重複/);
    expect(() => parseAqi(rows.slice(0, 50), NOW)).toThrow(/有效測站/);
    const future = rows.map((r) => ({ ...r, publishtime: "2026/10/16 03:00:00" }));
    expect(() => parseAqi(future, NOW)).toThrow(/有效測站 0/);
  });

  it("uses the secret when present and otherwise the data.gov.tw published link", async () => {
    const withSecret = await resolveAqiUrl("my-key", async () => { throw new Error("should not fetch"); });
    expect(withSecret.via).toBe("secret");
    expect(new URL(withSecret.url).searchParams.get("api_key")).toBe("my-key");

    const metadata = { result: { distribution: [
      { resourceFormat: "CSV", resourceDownloadUrl: "https://data.moenv.gov.tw/api/v2/aqx_p_432?api_key=csv-key&format=CSV" },
      { resourceFormat: "JSON", resourceDownloadUrl: "https://data.moenv.gov.tw/api/v2/aqx_p_432?api_key=json-key&format=JSON" },
    ] } };
    const fallback = await resolveAqiUrl(undefined, async (url) => (url === DATA_GOV_AQI_METADATA ? metadata : null));
    expect(fallback.via).toBe("data.gov.tw");
    expect(new URL(fallback.url).searchParams.get("api_key")).toBe("json-key");

    const hostile = { result: { distribution: [{ resourceFormat: "JSON", resourceDownloadUrl: "https://evil.example/aqx_p_432?api_key=x" }] } };
    await expect(resolveAqiUrl(undefined, async () => hostile)).rejects.toThrow(/公開下載連結/);
  });
});

describe("collectFeed", () => {
  const offline = (routes: Record<string, unknown>): JsonFetcher => async (url) => {
    const hit = Object.entries(routes).find(([prefix]) => url.startsWith(prefix));
    if (!hit) throw new Error("offline");
    return hit[1];
  };

  it("produces a valid, live envelope from fixtures", async () => {
    const envelope = await collectFeed("warnings", { fetchJson: offline({ [CWA_FILES.warnings]: fixture("W-C0033-001.json") }), now: () => NOW });
    expect(envelope.status).toBe("live");
    expect(envelope.sourceTime).toBe("2026-10-15T08:26:24.000Z");
    expect(parseFeedEnvelope("warnings", JSON.parse(JSON.stringify(envelope))).data?.counties).toHaveLength(22);
  });

  it("collects AQI through the fallback link without leaking the key", async () => {
    const metadata = { result: { distribution: [{ resourceFormat: "JSON", resourceDownloadUrl: "https://data.moenv.gov.tw/api/v2/aqx_p_432?api_key=public-key&format=JSON" }] } };
    const envelope = await collectAqi({
      fetchJson: offline({ [DATA_GOV_AQI_METADATA]: metadata, "https://data.moenv.gov.tw/api/v2/aqx_p_432": fixture("aqx_p_432.json") }),
      now: () => NOW,
    });
    expect(envelope.status).toBe("live");
    expect(envelope.data?.stations).toHaveLength(84);
    expect(JSON.stringify(envelope)).not.toContain("public-key");
    expect(() => parseFeedEnvelope("aqi", envelope)).not.toThrow();
  });

  it("turns failures into an unavailable envelope with a sanitized reason", async () => {
    const envelope = await collectFeed("heat", {
      fetchJson: async () => { throw new Error("GET https://x/?Authorization=CWA-secret failed"); },
      now: () => NOW,
    });
    expect(envelope).toMatchObject({ status: "unavailable", data: null, sourceTime: null, issues: ["讀取或驗證失敗"] });
    expect(() => parseFeedEnvelope("heat", envelope)).not.toThrow();
  });

  it("never publishes AQI failure details that could carry the key", async () => {
    const envelope = await collectAqi({ moenvApiKey: "k", fetchJson: async () => { throw new Error("GET https://data.moenv.gov.tw/api/v2/aqx_p_432?api_key=k"); }, now: () => NOW });
    expect(envelope).toMatchObject({ status: "unavailable", issues: ["讀取或驗證失敗"] });
  });

  it("reports HTTP errors without the URL", async () => {
    const fetchJson = createJsonFetcher("AQX_P_432", 1000, (async () => new Response("no", { status: 503 })) as typeof fetch);
    await expect(fetchJson("https://data.moenv.gov.tw/api/v2/aqx_p_432?api_key=k")).rejects.toThrow(/^AQX_P_432 HTTP 503$/);
  });
});
