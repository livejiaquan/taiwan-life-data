import { parseEnvelope, type FeedEnvelope, type FeedId } from "@taiwan-life-data/contract";
import { isAqiData } from "./aqi";
import type { FeedDataMap } from "./collect";
import { isHeatData } from "./heat";
import { isRainData } from "./rain";
import { isUvData } from "./uv";
import { isWarningsData } from "./warnings";

const DATA_VALIDATORS: { [K in FeedId]: (value: unknown) => value is FeedDataMap[K] } = {
  warnings: isWarningsData,
  uv: isUvData,
  heat: isHeatData,
  aqi: isAqiData,
  rain: isRainData,
};

export const parseFeedEnvelope = <K extends FeedId>(feed: K, input: unknown): FeedEnvelope<FeedDataMap[K]> =>
  parseEnvelope(input, feed, DATA_VALIDATORS[feed]);
