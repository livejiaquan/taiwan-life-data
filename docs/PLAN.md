# 台灣生活資料誌（taiwan-life-data）— 總計畫

> 決策者：主 session（tmux 視窗 1）。執行者：各階段 Claude Code session。
> 每階段結束前，必須更新 `docs/PROGRESS.md`（做了什麼、驗收證據、未完成、下一步），並在終端機印出 `PHASE <n> DONE`。

## 為什麼做這個
競品分析（`~/Development/_reports/taiwan-competitive-analysis.md`，**開工前必讀 §0、§1–5、§8–11**）結論：
- 官方資料分散在氣象署／環境部／勞動部／台電／水利署，沒有民間整合版「今天出門要注意什麼」。
- 我們 5 個分散站重複實作同一套管線，而且 GitHub Actions cron 實際 3–6 小時才跑一次，導致網站常顯示「無法評估」。
- GitHub star 來自開發者能用的東西（開放 JSON API、MCP server、Home Assistant），不是 dashboard 本身。

## 產品定義
一個網址、一個 repo（`livejiaquan/taiwan-life-data`，public，MIT）：
1. **首頁「出門前」卡**：選鄉鎮（全台 368 鄉鎮市區）→ 一張卡依序回答：警特報 → 熱傷害／UV → 空品 → 降雨。每項都顯示資料時間與狀態。
2. **今天的台灣**：電網碳強度＋綠電時段（台電機組資料 × 排放係數）、水庫蓄水。
3. **/status**：每個 feed 的資料年齡、最近成功時間、事故紀錄，自動產生。
4. **開放 JSON API＋文件**、**90 天歷史存檔**、**MCP server（npm 套件）**。
5. LINE 分享（文字＋圖卡，含資料時間）。

## 可沿用的既有程式（先讀再搬，不要重寫已經測過的邏輯）
| 來源 | 內容 |
|---|---|
| `~/Development/taiwan-weather-risk-dashboard` | 警特報、縣市天氣、信任優先設計（branch feat/trust-first-local-warnings） |
| `~/Development/taiwan-uv-heat-dashboard` | UV／高溫、免金鑰 CWA 公開檔案收集、公開建置防金鑰檢查（branch codex/ui-readability） |
| `~/Development/taiwan-aqi-dashboard` | AQI（AQX_P_432）、84 站、資料可信度基礎（branch codex/trustworthy-aqi-foundation） |
| `~/Development/taiwan-power-dashboard` | 台電機組層級解析（vanilla JS） |
| GitHub `livejiaquan/taiwan-reservoir-static` | 水庫 20 座（og:url 指錯帳號，搬時修） |
**只讀這些舊 repo，不要改它們。**

## 技術約束
- TypeScript monorepo（npm workspaces）：`packages/contract`（資料契約與驗證）、`packages/collectors`、`apps/web`（Vite＋React＋TS）、`packages/mcp-server`。
- 每個 feed 統一契約：`sourceTime`、`retrievedAt`、`status: live|delayed|stale|unavailable`、`source`（含授權／出處）。過期一律 fail-closed 顯示，不得假裝是即時。
- **金鑰絕不進瀏覽器或 public build**（沿用 UV 站的 `assertPublicBuildEnv` 作法）。優先使用免金鑰的官方公開檔案；必須用金鑰的（環境部 AQI）走 GitHub secret `MOENV_API_KEY`，若尚未設定就退回公開來源並在 PROGRESS 標記需要使用者補 secret。
- **新鮮度目標：每小時型 feed 的資料年齡 p95 ≤ 30 分鐘。** GitHub Actions schedule 不準，Phase 1 必須實測並選定方案，候選：
  (a) 瀏覽器直接抓「免金鑰＋允許 CORS」的官方端點，快照只當備援（實測各端點 CORS）；
  (b) Cloudflare Workers Cron（使用者尚未登入 wrangler——若選此方案，把需要使用者做的一步寫進 PROGRESS，不要卡住，先用其他方案上線）；
  (c) 其他不需新帳號且不違反 GitHub Actions 使用條款的方案。
  不要用「Actions 長時間迴圈＋自我觸發」這類灰色作法。
- 每個 collector 要有離線 fixture 測試；CI：lint、typecheck、test、build。
- 不在 commit、PR、程式註解留下 AI 協作痕跡（不加 Co-Authored-By）。
- 繁體中文介面；手機優先。

## 階段與驗收
| 階段 | 內容 | 驗收（要附實際指令輸出當證據） |
|---|---|---|
| **1 基礎** | monorepo、資料契約、搬入 警特報／UV＋熱傷害（CWA 健康氣象 dataset 143330）／AQI collectors＋測試、新鮮度方案實測與決定（寫 `docs/DECISIONS.md`）、CI、建立 GitHub repo 並部署最小可用頁 | 測試全過；CI 綠；線上網址 HTTP 200；DECISIONS 有各端點 CORS／延遲實測數據 |
| **2 出門前** | 首頁卡、鄉鎮級 368 選擇、/status 頁、LINE 分享、手機版 | 368 鄉鎮皆可選；4G 降速中階手機 LCP ≤ 1.5s、首屏 JS ≤ 150KB gzip、Lighthouse a11y ≥ 95（附報告） |
| **3 今天的台灣＋API** | 電網碳強度＋綠電時段（方法文件公開）、水庫、公開 JSON API＋文件、歷史存檔機制 | 碳強度方法與係數出處寫進 docs；API 文件可用；存檔每天自動累積 |
| **4 開發者與門面** | MCP server（npm 可安裝）、README（雙語、截圖、架構圖、資料來源授權）、`/status` 自動事故紀錄 | MCP 在 Claude Code 實際呼叫成功；README 截圖為真實畫面 |
