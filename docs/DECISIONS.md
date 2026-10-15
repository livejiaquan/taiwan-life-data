# 技術決策紀錄（DECISIONS）

每筆決策：背景 → 決定 → 依據（實測數據）→ 取捨／後續。實測時間皆為 2026-10-16（Asia/Taipei），量測機器在台灣（macOS，家用網路）。

---

## D1. Monorepo 結構

- **決定**：npm workspaces：`packages/contract`（資料契約）、`packages/collectors`（解析＋驗證，瀏覽器與 CI 共用）、`apps/web`（Vite＋React＋TS）。各套件直接以 TS 原始碼匯出（`exports: ./src/index.ts`），不另外編譯；Vite、Vitest、tsx 都能直接吃 TS。單一根 `tsconfig.json` 做 typecheck。
- **`packages/mcp-server`**：PLAN 第 4 階段才做，第 1 階段不建空殼（空套件只會增加 CI 雜訊）。
- **取捨**：之後要發佈 npm 套件（MCP）時，該套件需要自己的 build 步驟；屆時只對它加 `tsc -p`，不影響其他套件。

## D2. 新鮮度方案（PLAN 指定必須實測後決定）

### 實測 1：GitHub Actions `schedule` 實際間隔

以 `gh run list --event schedule -L 100` 取舊 repo 的實際觸發時間，計算相鄰兩次的間隔：

| repo | cron 設定 | 期間（UTC） | 實際觸發次數／應觸發 | 間隔 min / 中位數 / p95 / max（分鐘） |
|---|---|---|---|---|
| taiwan-weather-risk-dashboard | `17,47 * * * *`（每 30 分） | 10-04 12:27 → 10-15 15:05（266.6 h） | 100 / 533 | 2 / **135** / **406** / 598 |
| taiwan-power-dashboard | `*/10 * * * *`（每 10 分） | 09-25 10:31 → 10-15 12:34（482.0 h） | 100 / 2892 | 128 / **299** / **442** / 574 |
| taiwan-uv-heat-dashboard | 每 20 分 | 10-13 10:24 → 10-15 12:08（49.7 h） | 12 / 149 | 135 / **256** / **437** / 437 |

**結論**：Actions schedule 的 p95 間隔約 7 小時，**不可能**達成「資料年齡 p95 ≤ 30 分鐘」，只能當備援。

### 實測 2：各官方端點 CORS／延遲／大小

`curl -H 'Origin: https://livejiaquan.github.io'`，每端點 5 次（第二輪以 `npm run probe` 重測，數字一致）：

| Feed | 端點（免金鑰？） | `Access-Control-Allow-Origin` | OPTIONS 預檢 | 總時間（5 次） | 大小 | 官方更新節奏（由 Last-Modified／內文時間觀察） |
|---|---|---|---|---|---|---|
| 警特報 W-C0033-001 | `cwaopendata.s3…/Warning/W-C0033-001.json`（✅ 免金鑰） | `*` | 200 | 0.27–0.45 s | 3.4 KB | 有事才更新（LM 08:27Z，當時 8 小時沒變） |
| 觀測（含 UV）O-A0003-001 | `…/Observation/O-A0003-001.json`（✅） | `*` | 200 | 0.70–1.47 s | 669 KB | 每 10 分；00:10 觀測 → 00:19:20 發布（落後約 9 分） |
| 自動站 O-A0001-001 | `…/Observation/O-A0001-001.json`（✅） | `*` | 200 | 0.93–1.89 s | 1.36 MB | 每 10 分 |
| 雨量 O-A0002-001 | `…/Observation/O-A0002-001.json`（✅） | `*` | 200 | 1.20–2.93 s | 1.76 MB | 每 10 分 |
| 每日 UV 最大值 O-A0005-001 | `…/Observation/O-A0005-001.json`（✅） | `*` | 200 | 0.27–0.45 s | 2.4 KB | 每日 |
| 熱傷害 M-A0085-001（143330） | `…/Model/M-A0085-001.json`（✅） | `*` | 200 | 1.11–1.50 s（probe p50 2.9 s） | 2.90 MB | 每 6 小時（Update 22:00:54+08） |
| 縣市 3 日預報 F-D0047-089 | `…/Forecast/F-D0047-089.json`（✅） | `*` | 200 | 1.45–7.36 s | 1.76 MB | 每 3–6 小時 |
| 36 小時預報 F-C0032-001 | `…/Forecast/F-C0032-001.json`（✅） | `*` | 200 | 0.49–0.76 s | 82 KB | 每 6 小時 |
| AQI AQX_P_432 | `data.moenv.gov.tw/api/v2/aqx_p_432`（❌ 必須 `api_key`；無金鑰回「api_key 不存在。」） | `*` | 405 | 0.23–0.41 s（limit=1000） | 55 KB | 每小時；00:00 資料於 00:19 已可取得（單次觀察） |

註：S3 不做 gzip（`--compressed` 大小不變）；CWA `opendata.cwa.gov.tw/fileapi` 需 Authorization，無金鑰回 401。

### 決定：混合方案（a）＋（b，待使用者）

1. **CWA 三個 feed（警特報、UV 觀測、熱傷害）→ 方案 (a)**：瀏覽器直接讀 CWA 官方 S3 公開檔（免金鑰、`ACAO: *`，實測可行）。前端流程：先讀同源快照 → 以 `currentStatus()` 依「現在」重新判定 → 不是 `live` 才去讀官方檔，讀到就用、讀不到就退回快照並照實標示過舊／無法取得。
   - 警特報依據 `retrievedAt`（官方檔只在有事時更新，`sent` 舊不代表過期），所以幾乎每次都直接讀官方（3.4 KB，0.3 s）。
   - **預估資料年齡**：= 官方發布落差＋讀取時間。O-A0003-001 觀測時間到發布約 9–10 分、每 10 分一筆 → 讀到時的資料年齡最壞約 20 分 → 預估 p95 ≤ 30 分 ✅（**尚未連續量測**，第 2 階段 `/status` 會累積實際分布）。
2. **AQI → 伺服器端收集**，因為必須帶金鑰，金鑰不得進瀏覽器（PLAN 約束），所以不能用 (a)。
   - 現況：GitHub Actions 收集（每 15 分排程＋每次 push）。依實測 1，**AQI 的資料年齡 p95 目前會是數小時，未達標**，頁面會誠實顯示「延遲／過舊」。
   - **目標方案 (b) Cloudflare Workers Cron**（每 10 分）：需要使用者 `wrangler login`，已寫入 PROGRESS「需要使用者」。屆時 Worker 也負責產出瘦身後的 UV／熱傷害快照（見 D7）。
3. **不採用**：Actions 長時間迴圈／自我觸發（PLAN 禁止的灰色作法）；只靠 Actions schedule（實測 1 否決）。
4. **(c) 其他免新帳號方案的評估**：外部 cron 服務（cron-job.org 等）觸發 `workflow_dispatch` 需要新帳號＋在第三方存放 GitHub token，不符合「不需新帳號」；用使用者自己的電腦定時觸發不可靠。故 (c) 無合格選項。

另：GitHub 會在 repo 60 天沒有活動時停用 schedule，這是改用 Workers Cron 的另一個理由。

## D3. AQI 金鑰：`MOENV_API_KEY` 未設定時的公開來源

- **背景**：PLAN 要求 AQI 走 GitHub secret `MOENV_API_KEY`，未設定就退回公開來源。目前 secret 尚未設定。
- **決定**：未設定時，collector 於執行時讀 data.gov.tw 資料集 40448 的 metadata API，取環境部**公開刊登**在 data.gov.tw 的 JSON 下載連結（其中含環境部提供的共用 api_key），只接受 `https://data.moenv.gov.tw/api/v2/aqx_p_432` 這個網址。金鑰**不寫進 repo、不進瀏覽器、不寫進快照**；快照 `issues` 會標註「使用 data.gov.tw 公開下載連結（尚未設定 MOENV_API_KEY）」。
- **依據**：實測此連結 HTTP 200、84 站、資料時間與官方一致。
- **取捨**：共用金鑰可能被限流或更換；因為每次都即時從 data.gov.tw 解析，連結換了也會跟著換。正式運作仍建議設定自己的 `MOENV_API_KEY`（PROGRESS 需要使用者 #2）。

## D4. 熱傷害資料源

- data.gov.tw 143330 的下載連結是 `opendata.cwa.gov.tw/fileapi/v1/opendataapi/M-A0085-001?Authorization=rdec-key-…`，實測它 302 轉址到 `cwaopendata.s3…/Model/M-A0085-001.json`，**該 S3 檔免金鑰**。直接使用 S3 檔，與其他 CWA feed 同一機制，也避免把任何 Authorization 參數放進前端。
- 注意：此檔時間格式為 `+8:00`（單位數時區），`parseOfficialTime` 已處理並有測試。
- 368 鄉鎮全數存在（實測 22 縣市、368 鄉鎮、每鄉鎮 39 個逐 3 小時時段），collector 低於 368 一律拒收。

## D5. 各 feed 新鮮度門檻（`packages/contract/src/feed.ts`）

| Feed | 依據 | live ≤ | delayed ≤ | 之後 | 理由 |
|---|---|---|---|---|---|
| warnings | retrievedAt | 15 分 | 60 分 | stale | 事件型檔案，判斷依據是「最近有沒有成功讀到」 |
| uv | sourceTime（最新觀測時間） | 25 分 | 120 分 | stale | 每 10 分＋發布落差約 10 分＝最壞約 20 分；live 窗不得超過 30 分目標，否則前端會沿用舊快照不去更新（原設 40 分，線上實測時 30 分鐘舊的 UV 仍被當 live，故下修） |
| heat | sourceTime（發布時間） | 7 小時 | 13 小時 | stale | 每 6 小時一報 |
| aqi | sourceTime（publishtime） | 80 分 | 180 分 | stale | 每小時＋約 20 分發布落差 |

規則（fail-closed）：沒有資料 → `unavailable`；時間缺失、無法解析或比現在晚 15 分以上 → `stale`（絕不當 live）；`stale`／`unavailable` 時前端**不顯示結論**。快照裡存的 `status` 只是收集當下的判定，顯示時一律用 `currentStatus()` 依現在時間重算。

## D6. 公開建置防金鑰

- 沿用 UV 站 `assertPublicBuildEnv`：build 步驟環境變數出現任何金鑰即中止；collect 是唯一拿得到 secret 的步驟。
- 輸出掃描改為「參數名後面跟著像金鑰的值」才算洩漏（`api_key=` 後接 ≥8 字元等），因為驗證程式本身會出現 `api_key` 字樣；另禁止 `data.moenv.gov.tw/api/`、`opendata.cwa.gov.tw/api/` 等需金鑰的 API 網址出現在公開檔案。
- 第一次建置即被此檢查擋下（前端 bundle 帶到了 AQI 網址組裝程式），因此把 AQI 取得移到 `packages/collectors/src/server.ts`（僅伺服器端），前端只引用 CWA 部分。

## D7. 前端直接讀大檔的效能代價（第 2 階段處理）

- 快照不夠新時，瀏覽器會讀 UV 觀測 669 KB、熱傷害 2.9 MB（S3 不壓縮）。對 PLAN 第 2 階段「首屏 JS ≤ 150 KB、LCP ≤ 1.5 s」不是 JS 大小問題（目前 bundle 76.6 KB gzip），但會吃行動網路流量。
- 第 1 階段先求正確與新鮮；第 2 階段的處理方向：Workers Cron 產出每縣市瘦身 JSON（取代瀏覽器讀全檔），或只在使用者選定縣市後才讀。

## D8. 縣市級 vs 鄉鎮級；UV 不借鄰近縣市

- 第 1 階段頁面以 22 縣市呈現（熱傷害資料已是 368 鄉鎮全量，第 2 階段直接做鄉鎮選擇）。
- 只有約 30 個測站有紫外線值；沒有 UV 測站的縣市顯示「本縣市沒有紫外線測站，不推估」，不借鄰近縣市的值（避免把推估當觀測）。

## D9. Commit 不加 AI 協作標記

PLAN「技術約束」明定不在 commit／PR／註解留下 AI 協作痕跡（不加 Co-Authored-By）。這是使用者的專案指示，優先於工具預設的署名行為，所以 commit 不加 trailer。
