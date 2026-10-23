# 圖示與品牌標記

## 品牌標記

| 檔案 | 用途 |
|---|---|
| `apps/web/public/brand/mark.svg` | 標記原檔，64×64：圓角方形（圓角＝邊長 22%）填石板藍 `#315AB9`（hsl 222° 58% 46%），中間是白色 Lucide `compass`，佔邊長 58%，筆畫 2 |
| `apps/web/public/brand/favicon.svg` | 與 `mark.svg` 相同，網站 favicon（`apps/web/public/brand/favicon.svg`） |
| `apps/web/public/brand/apple-touch-icon.png` | 180×180，方形滿版（iOS 會自己裁圓角），由同一張圖用 Chrome 輸出 |

- 頁首使用同一個圖形（`Shell.tsx` 的 `BrandMark`，32px），右邊是字標「台灣生活資料誌」16px／600、副標「官方開放資料，出門前看一眼」12px／500，標記與字標間距 10px。
- 深色模式下標記顏色不變。

## 站內圖示（全部是 Lucide，`lucide-react` 1.52.0，ISC）

繪製參數統一：24px 格、`strokeWidth` 1.75、圓角端點與轉角、`currentColor`、不填色。尺寸只用 16／20／24。

| 用途 | Lucide 名稱 | 尺寸 | 位置 |
|---|---|---|---|
| 天氣警特報 | `triangle-alert` | 24 | 首頁今日重點、細節列 |
| 熱傷害指數 | `thermometer` | 24 | 同上 |
| 紫外線與氣溫 | `sun` | 24 | 同上 |
| 空氣品質 | `wind` | 24 | 同上 |
| 降雨機率 | `umbrella` | 24 | 同上 |
| 「今日重點」標題 | `activity` | 16 | 首頁摘要卡 |
| 電網碳強度 | `zap` | 24 | 今天的台灣 |
| 主要水庫蓄水率 | `droplet` | 24 | 今天的台灣 |
| 綠電時段 | `leaf` | 24 | 今天的台灣 |
| 外觀切換（跟隨系統／淺色／深色） | `sun-moon` | 20 | 頁首按鈕 |
| 下拉選單箭頭 | `chevron-down`（同一條 path，以 CSS data URI 內嵌） | 18 顯示 | 縣市、鄉鎮選單 |
| 品牌標記內圖 | `compass` | 標記 58% | 頁首、favicon |
