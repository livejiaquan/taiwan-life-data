import { createEnvelope, type FeedEnvelope, type FeedId } from "@taiwan-life-data/contract";
import type { AqiData } from "./aqi";
import type { JsonFetcher } from "./fetch";
import { parseHeat, trimHeat, type HeatData } from "./heat";
import { mergeRain, RAIN_COUNTIES, RAIN_FILE_CODES, trimRain, parseRainCounty, type RainData } from "./rain";
import { CWA_FILES, cwaRainFile } from "./sources";
import { newestObservation, parseUvObservations, type UvData } from "./uv";
import { parseWarnings, type WarningsData } from "./warnings";

export interface FeedDataMap {
  warnings: WarningsData;
  uv: UvData;
  heat: HeatData;
  aqi: AqiData;
  rain: RainData;
}

export interface CollectContext {
  fetchJson: JsonFetcher;
  now: () => number;
  via?: FeedEnvelope<unknown>["via"];
  /** Rain only: which counties to read (one ~1 MB file each). Defaults to all 22. */
  counties?: readonly string[];
}

/** Feeds a browser may fetch itself: keyless and CORS-enabled (docs/DECISIONS.md). */
export type BrowserFeedId = "warnings" | "uv" | "heat" | "rain";

function safeMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  // Belt and braces: never let anything URL-shaped into a published file.
  return /https?:/i.test(message) ? "讀取或驗證失敗" : message;
}

type Result<K extends BrowserFeedId> = { sourceTime: string | null; data: FeedDataMap[K]; issues?: string[] };

const collectors: { [K in BrowserFeedId]: (ctx: CollectContext) => Promise<Result<K>> } = {
  warnings: async (ctx) => {
    const data = parseWarnings(await ctx.fetchJson(CWA_FILES.warnings));
    return { sourceTime: data.sent, data };
  },
  uv: async (ctx) => {
    const data = parseUvObservations(await ctx.fetchJson(CWA_FILES.uv));
    return { sourceTime: newestObservation(data), data };
  },
  heat: async (ctx) => {
    const data = trimHeat(parseHeat(await ctx.fetchJson(CWA_FILES.heat)), ctx.now());
    return { sourceTime: data.issuedAt, data };
  },
  rain: async (ctx) => {
    const counties = ctx.counties ?? RAIN_COUNTIES;
    const issues: string[] = [];
    const parts: Array<ReturnType<typeof parseRainCounty>> = [];
    // Four at a time: 22 files of ~1 MB each.
    for (let i = 0; i < counties.length; i += 4) {
      const batch = counties.slice(i, i + 4);
      const results = await Promise.allSettled(batch.map(async (county) => parseRainCounty(await ctx.fetchJson(cwaRainFile(RAIN_FILE_CODES[county]!)), county)));
      results.forEach((r, j) => (r.status === "fulfilled" ? parts.push(r.value) : issues.push(`${batch[j]}：${safeMessage(r.reason)}`)));
    }
    const data = trimRain(mergeRain(parts), ctx.now());
    return { sourceTime: data.issuedAt, data, issues };
  },
};

export const BROWSER_FETCHABLE: readonly FeedId[] = ["warnings", "uv", "heat", "rain"] satisfies BrowserFeedId[];


/** Collects one feed. Never throws: failures become an "unavailable" envelope. */
export const collectFeed = async <K extends BrowserFeedId>(feed: K, ctx: CollectContext): Promise<FeedEnvelope<FeedDataMap[K]>> => {
  try {
    const result = await (collectors[feed] as (c: CollectContext) => Promise<Result<K>>)(ctx);
    return createEnvelope(feed, { ...result, via: ctx.via }, ctx.now());
  } catch (error) {
    return createEnvelope<FeedDataMap[K]>(feed, { sourceTime: null, data: null, issues: [safeMessage(error)], via: ctx.via }, ctx.now());
  }
};
