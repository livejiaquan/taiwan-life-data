/**
 * Server-only (collect step). Never import from browser code: MOENV requires an
 * api_key on every request, so these URLs must not reach a public bundle.
 * scripts/build-public.ts fails the build if they do.
 */
import { createEnvelope, type FeedEnvelope } from "@taiwan-life-data/contract";
import { newestPublishTime, parseAqi, type AqiData } from "./aqi";
import { collectFeed, type CollectContext, type FeedDataMap } from "./collect";
import type { JsonFetcher } from "./fetch";
import { asRecord, toText, ValidationError } from "./parse";

export const MOENV_AQI_ENDPOINT = "https://data.moenv.gov.tw/api/v2/aqx_p_432";
/** data.gov.tw metadata for the AQI dataset; lists the officially published download link. */
export const DATA_GOV_AQI_METADATA = "https://data.gov.tw/api/v2/rest/dataset/40448";

/**
 * Builds the AQX_P_432 request URL.
 * - With MOENV_API_KEY (GitHub secret): our own key.
 * - Without it: the download link MOENV publishes on data.gov.tw dataset 40448,
 *   resolved at run time so no key is ever committed.
 * Server-side only: the returned URL contains a key and must never reach a browser.
 */
export const resolveAqiUrl = async (apiKey: string | undefined, fetchJson: JsonFetcher): Promise<{ url: string; via: "secret" | "data.gov.tw" }> => {
  const build = (key: string) => {
    const url = new URL(MOENV_AQI_ENDPOINT);
    url.searchParams.set("api_key", key);
    url.searchParams.set("limit", "1000");
    url.searchParams.set("sort", "ImportDate desc");
    url.searchParams.set("format", "JSON");
    return url.toString();
  };
  if (apiKey?.trim()) return { url: build(apiKey.trim()), via: "secret" };
  const metadata = asRecord(asRecord(await fetchJson(DATA_GOV_AQI_METADATA)).result);
  const distributions = Array.isArray(metadata.distribution) ? metadata.distribution : [];
  for (const d of distributions) {
    const link = toText(asRecord(d).resourceDownloadUrl);
    if (!link || toText(asRecord(d).resourceFormat)?.toUpperCase() !== "JSON") continue;
    const parsed = new URL(link);
    const key = parsed.searchParams.get("api_key");
    if (parsed.origin + parsed.pathname === MOENV_AQI_ENDPOINT && key) return { url: build(key), via: "data.gov.tw" };
  }
  throw new ValidationError("aqi", "data.gov.tw 未提供可用的公開下載連結");
};

export interface ServerContext extends CollectContext {
  moenvApiKey?: string;
}

const safeMessage = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  return /https?:|api[_-]?key|authori[sz]ation/i.test(message) ? "讀取或驗證失敗" : message;
};

export const collectAqi = async (ctx: ServerContext): Promise<FeedEnvelope<AqiData>> => {
  try {
    const { url, via } = await resolveAqiUrl(ctx.moenvApiKey, ctx.fetchJson);
    const data = parseAqi(await ctx.fetchJson(url), ctx.now());
    const issues = via === "data.gov.tw" ? ["使用 data.gov.tw 公開下載連結（尚未設定 MOENV_API_KEY）"] : [];
    return createEnvelope("aqi", { sourceTime: newestPublishTime(data), data, issues }, ctx.now());
  } catch (error) {
    return createEnvelope<AqiData>("aqi", { sourceTime: null, data: null, issues: [safeMessage(error)] }, ctx.now());
  }
};

/** Every feed, for the snapshot collector. */
export const collectAny = async <K extends keyof FeedDataMap>(feed: K, ctx: ServerContext): Promise<FeedEnvelope<FeedDataMap[K]>> =>
  (feed === "aqi" ? collectAqi(ctx) : collectFeed(feed as Exclude<K, "aqi">, ctx)) as Promise<FeedEnvelope<FeedDataMap[K]>>;
