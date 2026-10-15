import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { FEEDS, type FeedId } from "@taiwan-life-data/contract";
import type { DataSource } from "./data";
import { dataStatus, gridCarbon, history, InputError, listTowns, outdoorBrief, reservoirs } from "./tools";

declare const __VERSION__: string;
const VERSION = typeof __VERSION__ === "string" ? __VERSION__ : "0.0.0-dev";

const FEED_IDS = Object.keys(FEEDS) as [FeedId, ...FeedId[]];

const run = async (work: () => Promise<string> | string) => {
  try {
    return { content: [{ type: "text" as const, text: await work() }] };
  } catch (error) {
    // Input problems go back to the model so it can correct itself; anything else is a generic failure.
    const text = error instanceof InputError ? error.message : `讀取資料失敗：${error instanceof Error ? error.message : String(error)}`;
    return { content: [{ type: "text" as const, text }], isError: true };
  }
};

const readOnly = { readOnlyHint: true, openWorldHint: true } as const;

export const createServer = (src: DataSource): McpServer => {
  const server = new McpServer(
    { name: "taiwan-life-data", version: VERSION },
    {
      instructions:
        "台灣生活資料誌：台灣官方開放資料（氣象署、環境部、台電、水利署）的整合查詢。每個結果都附資料時間與狀態（即時／延遲／過舊／無法取得）；過舊或無法取得時工具不下結論，回答使用者時也不要替它下結論，並保留資料時間。",
    },
  );

  server.registerTool(
    "outdoor_brief",
    {
      title: "出門前（鄉鎮級）",
      description:
        "Township-level 'before you go out' brief for any of Taiwan's 368 townships: weather warnings, heat-injury index, UV and temperature, air quality (AQI) and 12-hour rain probability, each with official data time and freshness status. 依序回答警特報→熱傷害→紫外線→空品→降雨。",
      inputSchema: {
        town: z.string().describe("鄉鎮市區，例如「安南區」「信義區」「礁溪鄉」；可省略「區／鄉／鎮／市」"),
        county: z.string().optional().describe("縣市，例如「臺南市」或「台南市」；鄉鎮名稱全台唯一時可省略"),
      },
      annotations: readOnly,
    },
    ({ town, county }) => run(() => outdoorBrief(src, county, town)),
  );

  server.registerTool(
    "list_towns",
    {
      title: "列出縣市與鄉鎮市區",
      description: "List Taiwan's 22 counties, or the townships of one county (names accepted by outdoor_brief).",
      inputSchema: { county: z.string().optional().describe("縣市；省略則列出全部縣市") },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ county }) => run(() => listTowns(county)),
  );

  server.registerTool(
    "grid_carbon",
    {
      title: "電網碳強度與綠電時段",
      description:
        "Current carbon intensity of Taiwan's grid (gCO2e/kWh, lifecycle and direct) from Taipower unit-level generation, the fuel mix, load and reserve light, and the lowest-carbon 3-hour window from the last 14 days of samples.",
      annotations: readOnly,
    },
    () => run(() => gridCarbon(src)),
  );

  server.registerTool(
    "reservoirs",
    {
      title: "主要水庫蓄水",
      description: "Storage percentage of Taiwan's 20 main reservoirs (Water Resources Agency), grouped north/central/south. Optional filter by reservoir name, county or region.",
      inputSchema: { query: z.string().optional().describe("篩選：水庫名（如「曾文」）、縣市或「北部／中部／南部」") },
      annotations: readOnly,
    },
    ({ query }) => run(() => reservoirs(src, query)),
  );

  server.registerTool(
    "data_status",
    {
      title: "資料狀態與事故紀錄",
      description: "Freshness of every feed, last successful collection, collector schedule gaps and the automatic incident log (same data as the /status page).",
      annotations: readOnly,
    },
    () => run(() => dataStatus(src)),
  );

  server.registerTool(
    "history",
    {
      title: "歷史存檔",
      description: "The 90-day history archive: list the dates kept for a feed, or summarise one Taipei date (for power, the carbon-intensity series).",
      inputSchema: {
        feed: z.enum(FEED_IDS).describe("warnings | uv | heat | aqi | rain | power | reservoir"),
        date: z.string().optional().describe("台北日期 YYYY-MM-DD；省略則列出可用日期"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ feed, date }) => run(() => history(src, feed, date)),
  );

  return server;
};
