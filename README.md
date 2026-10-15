# 台灣生活資料誌（taiwan-life-data）

選鄉鎮市區（全台 368 個），一張卡回答「今天出門要注意什麼」：天氣警特報 → 熱傷害／紫外線 → 空氣品質 → 降雨，可一鍵分享到 LINE（文字或圖卡）。
資料全部來自官方開放資料，每一項都標示**官方資料時間**；資料過舊或讀不到時一律不下結論（fail-closed）。

另有「今天的台灣」：電網碳強度（方法與係數出處公開）、綠電時段、20 座主要水庫蓄水率；所有資料都以**開放 JSON API** 公開，並自動累積 **90 天歷史存檔**。

線上版：https://livejiaquan.github.io/taiwan-life-data/ ・今天的台灣：https://livejiaquan.github.io/taiwan-life-data/today/ ・資料狀態與事故紀錄：https://livejiaquan.github.io/taiwan-life-data/status/

- 開放 JSON API 與存檔格式：[`docs/API.md`](docs/API.md)
- 碳強度計算方法與係數出處：[`docs/METHODOLOGY-carbon.md`](docs/METHODOLOGY-carbon.md)

> 開發中（第 3 階段：今天的台灣＋API）。計畫與進度見 [`docs/PLAN.md`](docs/PLAN.md)、[`docs/PROGRESS.md`](docs/PROGRESS.md)，技術決策與實測數據見 [`docs/DECISIONS.md`](docs/DECISIONS.md)。

## 資料來源

| Feed | 機關 | 資料集 | 更新 | 取得方式 |
|---|---|---|---|---|
| 天氣警特報 | 交通部中央氣象署 | W-C0033-001 | 有發布／解除時 | 瀏覽器直接讀官方公開檔案（快照備援） |
| 紫外線與氣溫觀測 | 交通部中央氣象署 | O-A0003-001 | 每 10 分鐘 | 同上 |
| 熱傷害指數（368 鄉鎮） | 交通部中央氣象署 | M-A0085-001（[data.gov.tw 143330](https://data.gov.tw/dataset/143330)） | 每 6 小時 | 同上 |
| 空氣品質指標 | 環境部 | AQX_P_432 | 每小時 | 伺服器端收集快照（需金鑰，金鑰不進瀏覽器） |
| 3 小時降雨機率（368 鄉鎮） | 交通部中央氣象署 | F-D0047-001～085（各縣市鄉鎮 3 天預報） | 一天 4 次 | 快照；不夠新時瀏覽器只讀所選縣市那一檔 |
| 電網碳強度、能源別發電 | 台灣電力公司 | 各機組發電量即時資訊（[data.gov.tw 8931](https://data.gov.tw/dataset/8931)）、今日系統供需狀況（[162595](https://data.gov.tw/dataset/162595)） | 每 10 分鐘 | 伺服器端收集快照（官方檔不允許跨網域） |
| 水庫蓄水率（20 座） | 經濟部水利署 | 水庫水情資料（[data.gov.tw 45501](https://data.gov.tw/dataset/45501)）、水庫每日營運狀況（[41568](https://data.gov.tw/dataset/41568)） | 每小時（部分每日） | 快照；不夠新時瀏覽器直接讀官方 API |

授權：政府資料開放授權條款－第 1 版。

## 架構

```
packages/contract     資料契約：sourceTime / retrievedAt / status(live|delayed|stale|unavailable) / source
packages/collectors   各 feed 的解析與驗證（瀏覽器與 CI 共用）；src/server.ts 為僅限伺服器端的 AQI 取得
apps/web              Vite + React + TypeScript 前端（首頁、/today、/status；建置時預先渲染首屏）
scripts/              公開建置防金鑰檢查、歷史存檔、端點實測腳本
data 分支             歷史存檔（每個 feed 每天一檔，收集時自動 commit）
```

```sh
npm install
npm test            # 離線 fixture 測試
npm run collect     # 抓官方資料寫入 apps/web/public/data/
npm run archive -- archive-data   # 把這次快照併入存檔（archive-data 為 data 分支的 checkout）
npm run dev
npm run probe       # 重新實測各端點 CORS／延遲
npm run gen:towns   # 從氣象署官方檔重新產生 368 鄉鎮清單
```

## 授權

MIT
