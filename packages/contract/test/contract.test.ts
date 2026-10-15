import { describe, expect, it } from "vitest";
import { COUNTIES, computeStatus, createEnvelope, currentStatus, distanceKm, FEEDS, findTown, formatTaipei, normalizeCountyName, parseEnvelope, isStatusDoc, parseOfficialTime, percentile, TOWNS, townsOf, updateStatus, openCollectGap, mergeIncidentLog, isIncidentLog, incidentKey, incidentsAtom } from "../src/index";

const at = (iso: string) => Date.parse(iso);

describe("parseOfficialTime", () => {
  it("reads every official timestamp shape as Taiwan time", () => {
    const expected = at("2026-10-16T00:00:00+08:00");
    expect(parseOfficialTime("2026-10-16T00:00:00+08:00")).toBe(expected);
    expect(parseOfficialTime("2026-10-16T00:00:00+8:00")).toBe(expected);
    expect(parseOfficialTime("2026/10/16 00:00:00")).toBe(expected);
    expect(parseOfficialTime("2026-10-16")).toBe(expected);
    expect(parseOfficialTime("2026-10-15T16:00:00Z")).toBe(expected);
    expect(parseOfficialTime("2026-10-15T16:00:00.000Z")).toBe(expected);
  });

  it("rejects non-timestamps", () => {
    for (const bad of ["", "soon", "2026-13-45T99:00:00", null, 123, undefined]) expect(parseOfficialTime(bad)).toBeUndefined();
  });
});

describe("computeStatus (fail-closed)", () => {
  const policy = FEEDS.aqi.freshness; // live ≤ 80 min, delayed ≤ 180 min
  const now = at("2026-10-16T12:00:00+08:00");
  const status = (sourceTime: string | null, hasData = true) => computeStatus(policy, { sourceTime, retrievedAt: new Date(now).toISOString() }, hasData, now);

  it("grades by age of the official timestamp", () => {
    expect(status("2026-10-16T11:00:00+08:00")).toBe("live");
    expect(status("2026-10-16T10:00:00+08:00")).toBe("delayed");
    expect(status("2026-10-16T08:00:00+08:00")).toBe("stale");
  });

  it("never reports missing, unparseable or far-future times as live", () => {
    expect(status(null)).toBe("stale");
    expect(status("garbage")).toBe("stale");
    expect(status("2026-10-16T13:00:00+08:00")).toBe("stale");
    expect(status("2026-10-16T11:30:00+08:00", false)).toBe("unavailable");
  });

  it("uses retrievedAt for event-driven feeds", () => {
    const policyW = FEEDS.warnings.freshness;
    const oldSent = "2026-10-15T08:00:00+08:00";
    expect(computeStatus(policyW, { sourceTime: oldSent, retrievedAt: "2026-10-16T03:55:00Z" }, true, now)).toBe("live");
    expect(computeStatus(policyW, { sourceTime: oldSent, retrievedAt: "2026-10-16T02:00:00Z" }, true, now)).toBe("stale");
  });

  it("re-evaluates a stored envelope instead of trusting its status", () => {
    const made = at("2026-10-16T01:10:00+08:00");
    const envelope = createEnvelope("aqi", { sourceTime: "2026-10-16T01:00:00+08:00", data: { stations: [] } }, made);
    expect(envelope.status).toBe("live");
    expect(currentStatus(envelope, made + 6 * 3_600_000)).toBe("stale");
  });
});

describe("parseEnvelope", () => {
  const ok = (d: unknown): d is { n: number } => typeof d === "object" && d !== null && "n" in d;
  const now = at("2026-10-16T01:10:00+08:00");

  it("accepts a well-formed envelope", () => {
    const envelope = createEnvelope("heat", { sourceTime: "2026-10-16T00:00:00+08:00", data: { n: 1 } }, now);
    expect(parseEnvelope(JSON.parse(JSON.stringify(envelope)), "heat", ok).data).toEqual({ n: 1 });
  });

  it("rejects wrong feed, bad data, inconsistent unavailable and credential markers", () => {
    const envelope = createEnvelope("heat", { sourceTime: null, data: { n: 1 } }, now);
    expect(() => parseEnvelope(envelope, "uv", ok)).toThrow(/feed/);
    expect(() => parseEnvelope({ ...envelope, data: { x: 1 } }, "heat", ok)).toThrow(/data/);
    expect(() => parseEnvelope({ ...envelope, data: null, status: "live" }, "heat", ok)).toThrow(/status/);
    expect(() => parseEnvelope({ ...envelope, issues: ["https://x?api_key=abc"] }, "heat", ok)).toThrow(/credential/);
  });
});

describe("helpers", () => {
  it("normalizes 台/臺 county names", () => {
    expect(normalizeCountyName("台北市")).toBe("臺北市");
    expect(normalizeCountyName("火星市")).toBeUndefined();
  });

  it("formats Taiwan wall-clock time", () => {
    expect(formatTaipei("2026-10-15T16:20:00Z")).toBe("10/16 00:20");
    expect(formatTaipei(null)).toBe("—");
  });
});

describe("townships", () => {
  it("lists all 368 townships with unique geocodes, every county covered", () => {
    expect(TOWNS).toHaveLength(368);
    expect(new Set(TOWNS.map((t) => t.geocode)).size).toBe(368);
    expect(COUNTIES.reduce((n, c) => n + townsOf(c.name).length, 0)).toBe(368);
    for (const c of COUNTIES) expect(townsOf(c.name).length, c.name).toBeGreaterThan(0);
    for (const t of TOWNS) expect(t.geocode.startsWith(COUNTIES.find((c) => c.name === t.county)!.geocode), t.town).toBe(true);
  });

  it("resolves every township by name, accepting 台 for 臺", () => {
    for (const t of TOWNS) expect(findTown(t.county, t.town)).toBe(t);
    expect(findTown("台南市", "東區")?.geocode).toBe("67000320");
    expect(findTown("臺南市", "不存在區")).toBeUndefined();
    expect(findTown("臺北市", "東區")).toBeUndefined();
  });

  it("measures distance in km", () => {
    expect(distanceKm({ lat: 25.0330, lon: 121.5654 }, { lat: 22.6273, lon: 120.3014 })).toBeCloseTo(297, -1);
  });
});

describe("status history", () => {
  const ok = (feed: "aqi" | "uv", status: "live" | "stale" = "live") => ({ feed, attemptOk: true, error: null, status, sourceTime: "2026-10-16T00:00:00.000Z", ageMinutes: status === "live" ? 20 : 300 });
  const failed = { feed: "aqi" as const, attemptOk: false, error: "AQX_P_432 HTTP 503", status: "delayed" as const, sourceTime: "2026-10-16T00:00:00.000Z", ageMinutes: 95 };

  it("records last success and opens/closes incidents on transitions", () => {
    const s1 = updateStatus(null, "2026-10-16T01:00:00.000Z", [ok("aqi"), ok("uv")]);
    expect(s1.feeds.aqi).toMatchObject({ lastAttemptOk: true, lastSuccessAt: "2026-10-16T01:00:00.000Z" });
    expect(s1.incidents).toEqual([]);

    const s2 = updateStatus(s1, "2026-10-16T02:00:00.000Z", [failed, ok("uv", "stale")]);
    expect(s2.feeds.aqi).toMatchObject({ lastAttemptOk: false, lastSuccessAt: "2026-10-16T01:00:00.000Z", lastError: "AQX_P_432 HTTP 503", status: "delayed" });
    expect(s2.incidents.map((i) => [i.feed, i.kind, i.endedAt])).toEqual([["aqi", "collect-failed", null], ["uv", "stale", null]]);

    const s3 = updateStatus(s2, "2026-10-16T03:00:00.000Z", [failed, ok("uv")]);
    expect(s3.incidents).toHaveLength(2); // still the same open aqi incident
    expect(s3.incidents[1]!.endedAt).toBe("2026-10-16T03:00:00.000Z");

    const s4 = updateStatus(s3, "2026-10-16T04:00:00.000Z", [ok("aqi"), ok("uv")]);
    expect(s4.incidents.every((i) => i.endedAt !== null)).toBe(true);
    expect(s4.runs).toHaveLength(4);
    expect(isStatusDoc(JSON.parse(JSON.stringify(s4)))).toBe(true);
  });

  it("caps history but keeps open incidents", () => {
    let doc = updateStatus(null, "2026-10-16T00:00:00.000Z", [failed], { runs: 3, incidents: 1 });
    for (let h = 1; h < 6; h++) doc = updateStatus(doc, `2026-10-16T0${h}:00:00.000Z`, [h % 2 ? ok("aqi") : failed], { runs: 3, incidents: 1 });
    expect(doc.runs.map((r) => r.at.slice(11, 13))).toEqual(["03", "04", "05"]);
    expect(doc.incidents).toHaveLength(1);
  });

  it("tracks how long an incident lasted and how bad it got", () => {
    let doc = updateStatus(null, "2026-10-16T01:00:00.000Z", [ok("uv", "stale")]);
    doc = updateStatus(doc, "2026-10-16T01:30:00.000Z", [{ ...ok("uv", "stale"), ageMinutes: 340 }]);
    expect(doc.incidents).toHaveLength(1);
    expect(doc.incidents[0]).toMatchObject({ runs: 2, lastSeenAt: "2026-10-16T01:30:00.000Z", worstAgeMinutes: 340, endedAt: null });
  });

  it("records a collector gap when the next run finally arrives, and shows an open one live", () => {
    const s1 = updateStatus(null, "2026-10-16T01:00:00.000Z", [ok("aqi")]);
    expect(openCollectGap(s1, Date.parse("2026-10-16T01:45:00.000Z"))).toBeNull();
    const open = openCollectGap(s1, Date.parse("2026-10-16T04:00:00.000Z"));
    expect(open).toMatchObject({ feed: "collector", kind: "collect-gap", startedAt: "2026-10-16T01:00:00.000Z", endedAt: null });
    expect(open!.detail).toContain("3 小時");

    const s2 = updateStatus(s1, "2026-10-16T04:00:00.000Z", [ok("aqi")]);
    expect(s2.incidents).toEqual([expect.objectContaining({ feed: "collector", kind: "collect-gap", startedAt: "2026-10-16T01:00:00.000Z", endedAt: "2026-10-16T04:00:00.000Z" })]);
    expect(isStatusDoc(JSON.parse(JSON.stringify(s2)))).toBe(true);
    // Exactly the threshold is not a gap.
    expect(updateStatus(s2, "2026-10-16T05:00:00.000Z", [ok("aqi")]).incidents).toHaveLength(1);
  });

  it("still accepts status.json written before incidents had lastSeenAt/runs", () => {
    const legacy = { schemaVersion: 1, generatedAt: "x", feeds: {}, runs: [], incidents: [{ feed: "aqi", kind: "stale", startedAt: "2026-10-16T00:00:00.000Z", endedAt: null, detail: "d" }] };
    expect(isStatusDoc(legacy)).toBe(true);
    expect(isStatusDoc({ ...legacy, incidents: [{ ...legacy.incidents[0], kind: "mystery" }] })).toBe(false);
    expect(isStatusDoc({ ...legacy, incidents: [{ ...legacy.incidents[0], feed: "nope" }] })).toBe(false);
  });

  it("keeps a long-term incident log beyond status.json's cap", () => {
    const old = { feed: "aqi" as const, kind: "stale" as const, startedAt: "2026-06-01T00:00:00.000Z", endedAt: "2026-06-01T02:00:00.000Z", detail: "old" };
    const openThen = { feed: "uv" as const, kind: "stale" as const, startedAt: "2026-10-15T00:00:00.000Z", endedAt: null, detail: "open" };
    const now = Date.parse("2026-10-16T12:00:00.000Z");
    const log1 = mergeIncidentLog(null, [old, openThen], now);
    expect(log1.incidents.map((i) => i.detail)).toEqual(["open"]); // older than 90 days and closed → dropped
    const closed = { ...openThen, endedAt: "2026-10-16T01:00:00.000Z" };
    const log2 = mergeIncidentLog(log1, [closed], now);
    expect(log2.incidents).toEqual([closed]);
    // An incident that fell out of status.json stays in the log.
    expect(mergeIncidentLog(log2, [], now).incidents).toEqual([closed]);
    expect(isIncidentLog(JSON.parse(JSON.stringify(log2)))).toBe(true);
    expect(incidentKey(closed)).toBe("uv/stale/2026-10-15T00:00:00.000Z");
  });

  it("publishes incidents as an escaped Atom feed", () => {
    let doc = updateStatus(null, "2026-10-16T01:00:00.000Z", [{ ...failed, error: "<bad> & worse" }]);
    doc = updateStatus(doc, "2026-10-16T03:00:00.000Z", [ok("aqi")]);
    const atom = incidentsAtom(doc, "https://example.org/site");
    expect(atom).toContain("<title>[已恢復] 空氣品質指標：收集失敗</title>");
    expect(atom).toContain("[已恢復] 收集排程：收集中斷");
    expect(atom).toContain("&lt;bad&gt; &amp; worse");
    expect(atom).not.toContain("<bad>");
    expect(atom).toContain('href="https://example.org/site/data/incidents.xml"');
    expect(atom.match(/<entry>/g)).toHaveLength(2);
  });

  it("computes nearest-rank percentiles", () => {
    expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 100], 95)).toBe(19);
    expect(percentile([], 95)).toBeUndefined();
  });
});
