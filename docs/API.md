# 開放 JSON API

台灣生活資料誌把收集到的官方開放資料，以**靜態 JSON** 公開。不用金鑰、不用註冊、允許跨網域（`Access-Control-Allow-Origin: *`），瀏覽器、腳本、Home Assistant、MCP 都能直接讀。

- **Base URL**：`https://livejiaquan.github.io/taiwan-life-data/`
- **版本**：所有檔案都有 `schemaVersion: 1`。不相容的變更會換成新路徑（例如 `archive/v2/`），不會在原路徑改格式。
- **快取**：GitHub Pages 回應 `Cache-Control: max-age=600`；需要最新請加查詢字串（例如 `?t=<時間>`）。
- **授權**：資料依各機關的[政府資料開放授權條款－第1版](https://data.gov.tw/license)，使用時請註明原始機關（每份檔案的 `source` 都有）；本站程式碼 MIT。本站與各機關無隸屬關係。

> 最重要的一條規則：**不要相信檔案裡存的 `status`**。那是收集當下的判定。請用 `sourceTime`（或警特報的 `retrievedAt`）依下方門檻自己重新判定；`stale`／`unavailable` 時不要拿 `data` 下結論。

## 端點一覽

| 路徑 | 內容 | 更新 |
|---|---|---|
| `data/catalog.json` | 機器可讀的目錄：每個 feed 的路徑、官方來源、授權、新鮮度門檻、能否由瀏覽器直接讀官方檔 | 每次收集 |
| `data/index.json` | 每個 feed 的收集當下狀態、`sourceTime`、資料年齡（分鐘） | 每次收集 |
| `data/{feed}.json` | 最新快照（FeedEnvelope，見下） | 每次收集 |
| `data/status.json` | 收集紀錄、各 feed 健康狀態、事故清單（`/status` 頁的資料） | 每次收集 |
| `data/power-profile.json` | 綠電時段：本站最近 14 天的逐時平均碳強度 | 每次收集 |
| `archive/v1/index.json` | 歷史存檔目錄：每個 feed 有哪些日期 | 每次收集 |
| `archive/v1/{feed}/{YYYY-MM-DD}.json` | 某 feed 某一天（台北日期）的所有官方更新 | 每次收集 |

存檔另有鏡像：`https://raw.githubusercontent.com/livejiaquan/taiwan-life-data/data/v1/…`（repo 的 `data` 分支，git 歷史保留所有版本，CORS 同樣是 `*`）。

### Feed 一覽（`{feed}`）

| feed | 內容 | 官方來源 | `data` 型別 | live ≤ | delayed ≤ | 依據 |
|---|---|---|---|---|---|---|
| `warnings` | 天氣警特報（22 縣市） | 氣象署 W-C0033-001 | `WarningsData` | 15 分 | 60 分 | `retrievedAt` |
| `uv` | 紫外線與氣溫觀測 | 氣象署 O-A0003-001 | `UvData` | 25 分 | 120 分 | `sourceTime` |
| `heat` | 熱傷害指數（368 鄉鎮，逐 3 小時） | 氣象署 M-A0085-001 | `HeatData` | 7 小時 | 13 小時 | `sourceTime` |
| `aqi` | 空氣品質指標（約 84 站） | 環境部 AQX_P_432 | `AqiData` | 80 分 | 180 分 | `sourceTime` |
| `rain` | 3 小時降雨機率（368 鄉鎮） | 氣象署 F-D0047-0xx | `RainData` | 7.5 小時 | 13.5 小時 | `sourceTime` |
| `power` | 電網碳強度、能源別發電、負載 | 台電 d006001＋d006020 | `PowerData` | 30 分 | 90 分 | `sourceTime` |
| `reservoir` | 20 座主要水庫蓄水率 | 水利署 45501＋41568 | `ReservoirData` | 3 小時 | 12 小時 | `sourceTime` |

門檻的理由見 [DECISIONS](DECISIONS.md) D5、D11、D18、D19。型別原始碼在 `packages/collectors/src/*.ts`。

## FeedEnvelope（`data/{feed}.json`）

```ts
interface FeedEnvelope<T> {
  schemaVersion: 1;
  feed: "warnings" | "uv" | "heat" | "aqi" | "rain" | "power" | "reservoir";
  sourceTime: string | null;  // 資料中最新的官方時間（ISO 8601, UTC）
  retrievedAt: string;        // 從官方讀到的時間
  status: "live" | "delayed" | "stale" | "unavailable"; // 收集當下的判定，請自行重算
  via: "snapshot" | "browser";
  source: { agency: string; title: string; datasetId: string; url: string; license: string };
  issues: string[];           // 非致命問題（例如略過的列、上一次收集失敗）
  data: T | null;             // status 為 unavailable 時才是 null
}
```

重新判定（與網站使用同一段程式：`packages/contract/src/feed.ts` 的 `computeStatus`）：

1. `data` 是 `null` → `unavailable`。
2. 依據時間（見上表）缺失、無法解析、或比現在晚 15 分鐘以上 → `stale`。
3. 年齡 ≤ live 門檻 → `live`；≤ delayed 門檻 → `delayed`；否則 `stale`。

另外，多站／多水庫的 feed 每一列都有自己的時間（`observedAt`／`publishTime`）。網站對**每一列**也做同樣的 fail-closed：UV 測站超過 120 分、AQI 測站超過 180 分、水庫超過 48 小時就不採用該列（DECISIONS D17、D19）。

### 範例

```sh
# 現在電網每度電多少公克 CO2e（生命週期）、資料時間
curl -s https://livejiaquan.github.io/taiwan-life-data/data/power.json \
  | jq '{sourceTime, lifecycle: .data.intensity.lifecycle, direct: .data.intensity.direct, lowCarbonPercent: .data.lowCarbonPercent}'

# 曾文水庫蓄水率
curl -s https://livejiaquan.github.io/taiwan-life-data/data/reservoir.json \
  | jq '.data.reservoirs[] | select(.name == "曾文水庫") | {percent, observedAt}'

# 臺南市安南區（geocode 67000350）的熱傷害逐 3 小時預報
curl -s https://livejiaquan.github.io/taiwan-life-data/data/heat.json \
  | jq '.data.towns[] | select(.geocode == "67000350") | .points'
```

```js
// 瀏覽器：自己重新判定新鮮度
const env = await (await fetch("https://livejiaquan.github.io/taiwan-life-data/data/power.json")).json();
const ageMin = (Date.now() - Date.parse(env.sourceTime)) / 60000;
const status = env.data === null ? "unavailable" : ageMin < -15 ? "stale" : ageMin <= 30 ? "live" : ageMin <= 90 ? "delayed" : "stale";
if (status === "live" || status === "delayed") console.log(env.data.intensity.lifecycle, "gCO2e/kWh");
```

### `PowerData`（`data/power.json`）

| 欄位 | 說明 |
|---|---|
| `observedAt` | 台電機組資料時間（每 10 分鐘） |
| `categories[]` | `{ category, mw, units }`：能源別淨發電（MW）與機組數。`category` 為 `coal`／`gas`／`oil`／`cogeneration`／`nuclear`／`hydro`／`wind`／`solar`／`other-renewable`／`storage`（儲能放電）／`storage-load`（儲能充電，負值）／`other` |
| `generationMw` | 計算碳強度用的一次發電量（不含儲能） |
| `intensity` | `{ lifecycle, direct, basisMw }`：每度電公克 CO₂e。**生命週期**為主要指標，**直接排放**只算燃燒。方法見 [METHODOLOGY-carbon.md](METHODOLOGY-carbon.md) |
| `factorsVersion` | 使用的係數版本 |
| `lowCarbonPercent`／`renewablePercent` | 低碳（再生＋核能）、再生能源占一次發電的百分比 |
| `load` | `{ currentMw, reservePercent, indicator, publishedAt }` 或 `null`（今日系統供需狀況讀取失敗或與機組資料對不上時） |

### `ReservoirData`（`data/reservoir.json`）

`reservoirs[]`：`{ id, name, county, region, capacity, storage, percent, observedAt }`。`capacity`（有效容量）與 `storage`（有效蓄水量）單位為萬立方公尺；`percent` = storage ÷ capacity × 100，**超過 100 照官方數字呈現**。每座水庫的 `observedAt` 不同（部分水庫每天只報一次）。蓄水率不等於限水。

### `PowerProfile`（`data/power-profile.json`）

```ts
interface PowerProfile {
  schemaVersion: 1;
  kind: "recent";  // 由本站存檔計算（為何不用台電的季歷史檔，見 DECISIONS D20）
  basis: string; from: string | null; to: string | null; samples: number;
  hours: Array<{ hour: number; n: number; lifecycle: number | null }>; // 台北時間 0–23 時
  greenest: { startHour: number; endHour: number; lifecycle: number } | null; // 平均最低的連續 3 小時
  dirtiest: { startHour: number; endHour: number; lifecycle: number } | null;
  insufficient: string | null; // 樣本不足時的原因，此時 greenest/dirtiest 為 null
}
```

這是**過去的規律，不是預報**。需要至少 48 筆樣本、18 個小時有資料才會給出時段，否則 `insufficient` 會寫原因。

## 歷史存檔（`archive/v1/`）

- **保留**：網站上保留最近 **90 個台北日**；更舊的從 `data` 分支的最新版移除，但 git 歷史裡仍在。
- **一天一檔**：`archive/v1/{feed}/{YYYY-MM-DD}.json`，日期是官方資料時間的台北日期（警特報用讀取時間）。
- **去重**：同一個官方更新（同一個 `sourceTime`；警特報為內容相同）只存一次，所以樣本數＝官方實際更新且被本站收集到的次數。收集頻率受排程限制（DECISIONS D2），**存檔不保證每個官方時點都有**。

```ts
interface ArchiveDay {
  schemaVersion: 1;
  feed: string;
  date: string;         // YYYY-MM-DD（台北）
  source: FeedSource;
  format: string;       // samples[].data 的格式說明
  samples: Array<{ retrievedAt: string; sourceTime: string | null; status: string; data: unknown }>;
}
```

為了讓 90 天存得下，部分 feed 存精簡格式（欄位名稱就寫在檔案裡）：

| feed | `samples[].data` |
|---|---|
| `warnings`、`power` | 與快照的 `data` 相同 |
| `uv` | `{ columns: ["id","name","county","townCode","observedAt","uvIndex","temperature"], rows }`，只含有紫外線讀值的測站 |
| `aqi` | `{ columns: ["siteId","name","county","publishTime","aqi","status","pollutant","pm25","pm10","o3_8hr"], rows }` |
| `heat`、`rain` | `{ issuedAt, table: { columns: ["geocode", <各時段起點>…], rows } }`，值為熱傷害指數／降雨機率（%） |
| `reservoir` | `{ columns: ["id","name","observedAt","percent","storage","capacity"], rows }` |

```sh
# 某天所有碳強度樣本
curl -s https://livejiaquan.github.io/taiwan-life-data/archive/v1/power/2026-10-16.json \
  | jq -r '.samples[] | [.sourceTime, .data.intensity.lifecycle] | @tsv'

# 有哪些日期
curl -s https://livejiaquan.github.io/taiwan-life-data/archive/v1/index.json | jq '.feeds.power.dates'
```

## 穩定性承諾

- 欄位只會**新增**，不會在 `schemaVersion: 1` 內改名或改型別；新增欄位時舊程式不受影響。
- 金鑰永遠不會出現在任何公開檔案（建置時自動掃描，DECISIONS D6）。
- 有問題請開 [GitHub issue](https://github.com/livejiaquan/taiwan-life-data/issues)；資料異常會自動記在 [`/status`](https://livejiaquan.github.io/taiwan-life-data/status/)。
