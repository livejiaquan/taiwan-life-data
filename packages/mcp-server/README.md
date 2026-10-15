# taiwan-life-data-mcp

MCP server for **台灣生活資料誌 (taiwan-life-data)** — Taiwan's official open data, ready for Claude and other MCP clients. No API key, no account.

台灣官方開放資料（氣象署、環境部、台電、水利署）的 MCP server：鄉鎮級「出門前」、電網碳強度、水庫、資料狀態與歷史存檔。免金鑰。

## Install / 安裝

Claude Code:

```sh
# from npm
claude mcp add taiwan-life-data -- npx -y taiwan-life-data-mcp

# or from the GitHub release tarball (same build)
claude mcp add taiwan-life-data -- npx -y --package=https://github.com/livejiaquan/taiwan-life-data/releases/download/mcp-v0.1.0/taiwan-life-data-mcp-0.1.0.tgz taiwan-life-data-mcp
```

Claude Desktop / other clients (`mcpServers` config):

```json
{
  "mcpServers": {
    "taiwan-life-data": { "command": "npx", "args": ["-y", "taiwan-life-data-mcp"] }
  }
}
```

Requires Node.js ≥ 20. The package is a single bundled file with no runtime dependencies.

## Tools / 工具

| Tool | What it answers |
|---|---|
| `outdoor_brief` `{town, county?}` | 出門前：警特報 → 熱傷害 → 紫外線／氣溫 → 空品 → 降雨，for any of the 368 townships. `county` may be omitted when the township name is unique; 台/臺 and a missing 區/鄉/鎮/市 are accepted. |
| `list_towns` `{county?}` | The 22 counties, or one county's townships. |
| `grid_carbon` | Grid carbon intensity (gCO₂e/kWh, lifecycle and direct), fuel mix, load and reserve light, lowest-carbon 3-hour window. |
| `reservoirs` `{query?}` | Storage of the 20 main reservoirs, north/central/south; filter by name, county or region. |
| `data_status` | Freshness of every feed, last successful collection, collector gaps and the automatic incident log. |
| `history` `{feed, date?}` | The 90-day archive: available dates, or one Taipei day (for `power`, the carbon-intensity series). |

Every answer carries the **official data time**, the data age and a status — 即時 live / 延遲 delayed / 過舊 stale / 無法取得 unavailable — recomputed at call time. Stale or missing data gets **no verdict** (fail-closed), exactly like the website.

## Where the data comes from

1. The published snapshots at <https://livejiaquan.github.io/taiwan-life-data/data/> ([API docs](https://github.com/livejiaquan/taiwan-life-data/blob/main/docs/API.md)).
2. When a snapshot is not live (or misses the township), the server reads the **official file directly** from your machine, with the same parsers and validation as the site's collector. AQI uses the download link MOENV publishes on data.gov.tw, or your own key if you set `MOENV_API_KEY` (it never leaves your machine).

Results are cached for 2 minutes per process.

| Environment variable | Default | |
|---|---|---|
| `TAIWAN_LIFE_DATA_DIRECT` | `1` | `0` = snapshots only, never call official sources |
| `TAIWAN_LIFE_DATA_SITE` | public site | base URL of another deployment |
| `MOENV_API_KEY` | — | your own MOENV key for AQI direct reads |

## Example (real output, 2026-10-16 02:23 +08)

```
# 出門前：臺南市安南區
總結：各項都在一般範圍，正常出門

## 天氣警特報【即時】
目前沒有生效中的天氣警特報（正常）
- 警特報以縣市為單位發布（臺南市）
資料時間 10/16 02:11・資料年齡 12 分・本站快照・來源：交通部中央氣象署 W-C0033-001

## 紫外線與氣溫觀測【即時】
紫外線 0（低量級）（正常）
- 永康測站（約 6 公里） 10/16 02:00 觀測
- 氣溫 23.2°C（安南測站，約 5 公里，10/16 02:00）
資料時間 10/16 02:00・資料年齡 24 分・直接讀官方資料・來源：交通部中央氣象署 O-A0003-001
…
```

## License

Code: MIT. Data: 各機關依「政府資料開放授權條款－第 1 版」(Open Government Data License, version 1.0) — attribute 交通部中央氣象署、環境部、台灣電力公司、經濟部水利署 when you republish.
