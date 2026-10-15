import type { FeedDataMap } from "@taiwan-life-data/collectors";
import type { FeedEnvelope, FeedId, Town } from "@taiwan-life-data/contract";
import { assessAqi, assessHeat, assessRain, assessUv, assessWarnings, type Verdict } from "./assess";

/** Order of the 出門前 card (PLAN): warnings → heat / UV → air quality → rain. */
export type CardFeed = "warnings" | "heat" | "uv" | "aqi" | "rain";
export const ORDER: CardFeed[] = ["warnings", "heat", "uv", "aqi", "rain"];
export const SHORT_LABEL: Record<CardFeed, string> = { warnings: "警特報", heat: "熱傷害", uv: "紫外線", aqi: "空品", rain: "降雨" };

/** Rain snapshots can miss a county (partial collect); treat that as "no data here". */
export const covers = (feed: FeedId, envelope: FeedEnvelope<unknown> | null | undefined, town: Town) =>
  !!envelope?.data && (feed !== "rain" || (envelope.data as FeedDataMap["rain"]).towns.some((t) => t.geocode === town.geocode));

/** Only call with live or delayed data; stale or unavailable data gets no verdict (fail-closed). */
export const assessCard = (feed: CardFeed, data: unknown, town: Town, now: number): Verdict => {
  switch (feed) {
    case "warnings": return assessWarnings(data as FeedDataMap["warnings"], town, now);
    case "heat": return assessHeat(data as FeedDataMap["heat"], town, now);
    case "uv": return assessUv(data as FeedDataMap["uv"], town, now);
    case "aqi": return assessAqi(data as FeedDataMap["aqi"], town, now);
    case "rain": return assessRain(data as FeedDataMap["rain"], town, now);
  }
};

/** What to say instead of a verdict when the data is too old or missing. */
export const FAIL_CLOSED: Record<"stale" | "unavailable", (feed: FeedId) => string> = {
  stale: () => "資料過舊，不做判斷。請以官方網站為準。",
  unavailable: (feed) => (feed === "warnings" ? "目前讀不到警特報——這不代表沒有警特報。" : "目前無法取得這項資料。"),
};
