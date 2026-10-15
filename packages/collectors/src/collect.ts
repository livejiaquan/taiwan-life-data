import { createEnvelope, type FeedEnvelope, type FeedId } from "@taiwan-life-data/contract";
import type { AqiData } from "./aqi";
import type { JsonFetcher } from "./fetch";
import { parseHeat, trimHeat, type HeatData } from "./heat";
import { CWA_FILES } from "./sources";
import { newestObservation, parseUvObservations, type UvData } from "./uv";
import { parseWarnings, type WarningsData } from "./warnings";

export interface FeedDataMap {
  warnings: WarningsData;
  uv: UvData;
  heat: HeatData;
  aqi: AqiData;
}

export interface CollectContext {
  fetchJson: JsonFetcher;
  now: () => number;
  via?: FeedEnvelope<unknown>["via"];
}

/** Feeds a browser may fetch itself: keyless and CORS-enabled (docs/DECISIONS.md). */
export type BrowserFeedId = "warnings" | "uv" | "heat";

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
};

export const BROWSER_FETCHABLE: readonly FeedId[] = ["warnings", "uv", "heat"] satisfies BrowserFeedId[];

const safeMessage = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  // Belt and braces: never let anything URL-shaped into a published file.
  return /https?:/i.test(message) ? "讀取或驗證失敗" : message;
};

/** Collects one feed. Never throws: failures become an "unavailable" envelope. */
export const collectFeed = async <K extends BrowserFeedId>(feed: K, ctx: CollectContext): Promise<FeedEnvelope<FeedDataMap[K]>> => {
  try {
    const result = await (collectors[feed] as (c: CollectContext) => Promise<Result<K>>)(ctx);
    return createEnvelope(feed, { ...result, via: ctx.via }, ctx.now());
  } catch (error) {
    return createEnvelope<FeedDataMap[K]>(feed, { sourceTime: null, data: null, issues: [safeMessage(error)], via: ctx.via }, ctx.now());
  }
};
