import { describe, expect, it } from "vitest";
import { computeStatus, createEnvelope, currentStatus, FEEDS, formatTaipei, normalizeCountyName, parseEnvelope, parseOfficialTime } from "../src/index";

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
