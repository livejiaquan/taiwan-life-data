import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";
import { newestObservation, newestPublishTime, parseAqi, parseHeat, parseUvObservations, parseWarnings, type JsonFetcher } from "@taiwan-life-data/collectors";
import type { collectAny } from "@taiwan-life-data/collectors/server";
import { createEnvelope, updateStatus, type FeedEnvelope, type FeedId } from "@taiwan-life-data/contract";
import { createDataSource } from "../src/data";
import { createServer } from "../src/server";
import { dataStatus, outdoorBrief, resolveTown } from "../src/tools";

const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`../../collectors/test/fixtures/${name}`, import.meta.url), "utf8"));
const NOW = Date.parse("2026-10-16T00:20:00+08:00");
const SITE = "https://example.org/site/";
const HOUR = 3_600_000;

const warnings = parseWarnings(fixture("W-C0033-001.json"));
const heat = parseHeat(fixture("M-A0085-001.json"), 6);
const uv = parseUvObservations(fixture("O-A0003-001.json"), { minUvStations: 20, minCounties: 5 });
const aqi = parseAqi(fixture("aqx_p_432.json"), NOW);

/** Snapshots as the collect step would publish them, made `ageMs` before NOW. */
const snapshots = (ageMs = 0): Partial<Record<FeedId, FeedEnvelope<unknown>>> => ({
  warnings: createEnvelope("warnings", { sourceTime: warnings.sent, data: warnings }, NOW - ageMs),
  heat: createEnvelope("heat", { sourceTime: heat.issuedAt, data: heat }, NOW - ageMs),
  uv: createEnvelope("uv", { sourceTime: newestObservation(uv), data: uv }, NOW - ageMs),
  aqi: createEnvelope("aqi", { sourceTime: newestPublishTime(aqi), data: aqi }, NOW - ageMs),
});

const siteFetcher = (files: Record<string, unknown>) => (_label: string): JsonFetcher => async (url) => {
  const path = url.replace(SITE, "");
  if (!(path in files)) throw new Error(`HTTP 404 ${path}`);
  return structuredClone(files[path]);
};

const filesOf = (snaps: Partial<Record<FeedId, FeedEnvelope<unknown>>>, extra: Record<string, unknown> = {}) =>
  Object.fromEntries([...Object.entries(snaps).map(([feed, env]) => [`data/${feed}.json`, env]), ...Object.entries(extra)]);

const unavailable = ((feed: FeedId) => Promise.resolve(createEnvelope(feed, { sourceTime: null, data: null, issues: ["HTTP 503"] }, NOW))) as unknown as typeof collectAny;

describe("resolveTown", () => {
  it("accepts 台/臺, a missing suffix, or no county when the name is unique", () => {
    expect(resolveTown("台南市", "安南")).toMatchObject({ county: "臺南市", town: "安南區", geocode: "67000350" });
    expect(resolveTown(undefined, "礁溪鄉")).toMatchObject({ county: "宜蘭縣" });
  });
  it("asks for the county when the township name is ambiguous, and lists choices on typos", () => {
    expect(() => resolveTown(undefined, "中正區")).toThrow(/基隆市中正區、臺北市中正區/);
    expect(() => resolveTown("臺北市", "不存在區")).toThrow(/信義區/);
    expect(() => resolveTown("火星市", "信義區")).toThrow(/找不到縣市/);
  });
});

describe("data source", () => {
  it("uses a live snapshot without touching the official source", async () => {
    const collect = vi.fn(unavailable);
    const src = createDataSource({ siteUrl: SITE, now: () => NOW, fetchJson: siteFetcher(filesOf(snapshots())), collect });
    const read = await src.feed("aqi");
    expect(read).toMatchObject({ status: "live", via: "snapshot" });
    expect(collect).not.toHaveBeenCalled();
  });

  it("reads the official source when the snapshot is stale, and prefers it when it is fresher", async () => {
    const fresh = createEnvelope("aqi", { sourceTime: newestPublishTime(aqi), data: aqi }, NOW);
    const collect = vi.fn((() => Promise.resolve(fresh)) as unknown as typeof collectAny);
    const stale = { aqi: createEnvelope("aqi", { sourceTime: new Date(NOW - 5 * HOUR).toISOString(), data: aqi }, NOW - 5 * HOUR) };
    const src = createDataSource({ siteUrl: SITE, now: () => NOW, fetchJson: siteFetcher(filesOf(stale)), collect });
    const read = await src.feed("aqi");
    expect(read).toMatchObject({ status: "live", via: "official" });
    expect(read.notes.join()).toMatch(/直接讀官方/);
    // Cached within a conversation.
    await src.feed("aqi");
    expect(collect).toHaveBeenCalledTimes(1);
  });

  it("returns stale data as stale when the official read also fails (never upgraded)", async () => {
    const stale = { aqi: createEnvelope("aqi", { sourceTime: new Date(NOW - 5 * HOUR).toISOString(), data: aqi }, NOW - 5 * HOUR) };
    const src = createDataSource({ siteUrl: SITE, now: () => NOW, fetchJson: siteFetcher(filesOf(stale)), collect: unavailable });
    expect(await src.feed("aqi")).toMatchObject({ status: "stale", via: "snapshot" });
    expect(await src.feed("power")).toMatchObject({ status: "unavailable", via: null, envelope: null });
  });

  it("does not read 22 rain files when no township is given", async () => {
    const collect = vi.fn(unavailable);
    const src = createDataSource({ siteUrl: SITE, now: () => NOW, fetchJson: siteFetcher({}), collect });
    await src.feed("rain");
    expect(collect).not.toHaveBeenCalled();
    await src.feed("rain", resolveTown("臺北市", "信義區"));
    expect(collect).toHaveBeenCalledWith("rain", expect.objectContaining({ counties: ["臺北市"] }));
  });
});

describe("outdoor_brief", () => {
  it("gives verdicts with data time for live feeds and fails closed for the rest", async () => {
    const snaps = snapshots();
    // Heat snapshot from yesterday: must not produce a verdict.
    snaps.heat = createEnvelope("heat", { sourceTime: new Date(NOW - 20 * HOUR).toISOString(), data: heat }, NOW - 20 * HOUR);
    const src = createDataSource({ siteUrl: SITE, now: () => NOW, fetchJson: siteFetcher(filesOf(snaps)), direct: false });
    const text = await outdoorBrief(src, "臺北市", "信義區");
    expect(text).toContain("# 出門前：臺北市信義區");
    expect(text).toMatch(/## 天氣警特報【即時】\n目前沒有生效中的天氣警特報/);
    expect(text).toMatch(/## 熱傷害指數【過舊】\n資料過舊，不做判斷。/);
    expect(text).not.toContain("熱傷害指數 2"); // no index value leaks from stale data
    expect(text).toMatch(/## 空氣品質指標【即時】\nAQI \d+/);
    expect(text).toMatch(/## 降雨機率【無法取得】\n目前無法取得這項資料。/);
    expect(text).toMatch(/總結：.*熱傷害、降雨無法判斷/);
    expect(text).toContain("資料時間 10/16 00:00・資料年齡 20 分・本站快照・來源：環境部 AQX_P_432");
    expect(text).toContain(`${SITE}?county=%E8%87%BA%E5%8C%97%E5%B8%82&town=%E4%BF%A1%E7%BE%A9%E5%8D%80`);
  });
});

describe("data_status", () => {
  it("shows an open collector gap that status.json cannot record itself", async () => {
    const doc = updateStatus(null, new Date(NOW - 5 * HOUR).toISOString(), [{ feed: "aqi", attemptOk: true, error: null, status: "live", sourceTime: new Date(NOW - 5.3 * HOUR).toISOString(), ageMinutes: 20 }]);
    const src = createDataSource({ siteUrl: SITE, now: () => NOW, fetchJson: siteFetcher({ "data/status.json": doc }) });
    const text = await dataStatus(src);
    expect(text).toContain("[進行中] 收集排程・收集中斷");
    // Stored as live 5 hours ago; re-graded now.
    expect(text).toMatch(/空氣品質指標：快照現在過舊（資料年齡約 5 小時 18 分）/);
  });
});

describe("MCP protocol", () => {
  it("lists the tools and answers a call over a real client/server pair", async () => {
    const server = createServer(createDataSource({ siteUrl: SITE, now: () => NOW, fetchJson: siteFetcher({}), direct: false }));
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "0" });
    await Promise.all([server.connect(a), client.connect(b)]);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["data_status", "grid_carbon", "history", "list_towns", "outdoor_brief", "reservoirs"]);
    expect(tools.every((t) => t.annotations?.readOnlyHint)).toBe(true);
    const ok = await client.callTool({ name: "list_towns", arguments: { county: "連江縣" } });
    expect((ok.content as Array<{ text: string }>)[0]!.text).toContain("南竿鄉、北竿鄉、莒光鄉、東引鄉");
    const bad = await client.callTool({ name: "outdoor_brief", arguments: { town: "中正區" } });
    expect(bad.isError).toBe(true);
    await client.close();
  });
});
