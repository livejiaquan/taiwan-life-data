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

---

# 第 2 階段（2026-10-16）

## D10. 368 鄉鎮清單與選擇方式

- **來源**：`scripts/gen-towns.ts` 從 CWA M-A0085-001（熱傷害，368 鄉鎮全量，含 geocode 與中心點經緯度）產生 `packages/contract/src/towns.ts`，提交入庫（不在執行時抓），行政區調整時手動 `npm run gen:towns`。產生時若不是剛好 368 筆即失敗。gzip 後約 6 KB。
- **同一組 geocode** 也是 F-D0047 鄉鎮預報的 `Geocode`、O-A0003-001 測站的 `TownCode`，所以三個 feed 都能用 geocode 精準對到鄉鎮，不靠名稱比對（同名鄉鎮如「東區」在 4 個縣市都有）。
- **UI**：縣市 → 鄉鎮市區兩個原生 `<select>`（無障礙、手機原生滾輪、免額外 JS）。URL `?county=&town=` 可分享；第 1 階段的 `?county=` 舊連結仍可用（取該縣市第一個鄉鎮）；本機記住上次選擇；預設臺北市中正區。
- **驗證**：單元測試確認 368 個 geocode 唯一、每縣市至少一個、每個鄉鎮都能從 URL 還原；端對端以 headless Chrome 實際操作選單逐一選取 368 個鄉鎮（見 PROGRESS）。

## D11. 降雨：F-D0047 各縣市鄉鎮 3 天預報

- **資料源**：`cwaopendata.s3…/Forecast/F-D0047-0xx.json`（免金鑰、`ACAO: *`，實測 200），每縣市一檔，0.6–1.1 MB；全台單檔 F-D0047-093 在 S3 為 404。縣市與檔號對照（001 宜蘭…085 金門，奇數＝3 天）逐檔讀 `LocationsName` 實測確認，寫在 `RAIN_FILE_CODES`。
- **內容**：只取「3小時降雨機率」與「天氣現象」，快照保留未來 24 小時（8 段），全台 368 鄉鎮快照 gzip 約 6.6 KB。
- **驗證**：縣市名必須與檔號相符、該縣市每個鄉鎮都要在（少一個整檔拒收，避免「沒有預報」被誤讀成「不會下雨」）；快照收集時某縣市失敗，其餘縣市照常，失敗縣市寫進 `issues`，前端對該縣市改讀官方檔。
- **新鮮度**：依 `IssueTime`。官方說明鄉鎮預報一天發布 4 次（🔎 CWA 產品說明 https://www.cwa.gov.tw/Data/data_catalog/1-1-1.pdf 的搜尋摘要，PDF 本文未開啟）；實測 IssueTime 23:00 的檔案於 00:16 出現在 S3（落後約 75 分）。故 live ≤ 7.5 小時、delayed ≤ 13.5 小時。**下一次發布時間尚未實測**。
- **瀏覽器補抓**：快照不夠新或缺該縣市時，只讀使用者所選縣市那一檔（不是 22 檔）。

## D12. 鄉鎮級判定：每個 feed 的「這個鄉鎮」怎麼定義

| Feed | 鄉鎮級作法 | 理由 |
|---|---|---|
| 警特報 | 縣市層級（W-C0033-001 以縣市發布），列出 CWA 標的子區域（山區等），並明寫「以縣市為單位發布」 | 官方本來就不到鄉鎮；不自行推論哪些鄉鎮受影響 |
| 熱傷害 | 該鄉鎮自己的逐 3 小時官方指數與警示 | 官方原生鄉鎮級 |
| 紫外線 | **同縣市內**距離鄉鎮中心最近的 UV 測站，顯示距離 | 全台約 30 站有 UV；不跨縣市借值（延續 D8） |
| 氣溫 | 優先同鄉鎮（`TownCode`）的測站，否則同縣市最近 | 約 360 站有氣溫，多數鄉鎮有自己的站 |
| 空品 | 同縣市內最近測站為主，另列縣市最高值 | 84 站；最近站較貼近，最高值避免低估 |
| 降雨 | 該鄉鎮自己的 3 小時降雨機率，看未來 12 小時最高值 | 官方原生鄉鎮級 |

- 摘要列只點名需要留意的項目；AQI 51–100（官方「普通」）維持黃色但不在摘要點名，避免每天都喊「留意空品」。無法判斷的項目一律在摘要寫出「無法判斷」，不會被算進「正常」。

## D13. 效能：預先渲染＋hydration，LCP 不等 JS

- **問題**：第一版是純 SPA，Lighthouse（mobile：RTT 150 ms、1.6 Mbps、CPU 4×）LCP 2.0 s，LCP 元素是頁首說明文字，要等 React 才畫得出來。
- **決定**：建置時用 `react-dom/server` 把首屏（頁首、停用狀態的選單、5 個「讀取中」區塊）渲染進 HTML，CSS（4.4 KB）內嵌；client 用 `hydrateRoot`，且**第一次 render 不讀 URL／localStorage**（地點在 mount 後才決定），所以 hydration 沿用同一批 DOM 節點，LCP 不會在 JS 執行後重新觸發。
- **結果**（本機 `vite preview` 正式建置，gzip；完整數據 `docs/reports/phase2/lighthouse-runs.json`）：

| 量測方式 | 首頁 LCP | /status LCP | a11y | 首屏 JS（gzip 傳輸） |
|---|---|---|---|---|
| DevTools 實際降速（3 次） | 643 / 648 / 646 ms | 684 ms | 100 | 89.5 KB |
| 模擬降速 lantern（8 次） | 1353–1358 ms ×5、1541、1658、1810 ms（中位數 1356） | 1354 ms | 100 | 89.5 KB |

- **模擬模式超過 1.5 s 的 3 次**：LCP 元素仍是同一個說明段落，差在 Render Delay（離群次約 1.5 s）。原因是本機伺服器太快，JS 在瀏覽器第一次繪製前就已執行，lantern 便把 JS 下載與執行算進 LCP 的相依圖；真實網路上 HTML 會比 JS 早到。DevTools 實際降速模式（真的套延遲與頻寬）3/3 為 0.66 s。
- **版面位移（CLS）**：第一版 0.06–0.19，來源是「向官方確認中」多出一行又消失、摘要列讀取中文字換行、警特報區塊填入後變高。改為確認中顯示在徽章、摘要列讀完前只顯示短句、區塊預留 11rem 後降到 0.017–0.021。
- **試過但不採用**：(1) 首次繪製後才動態 import app：模擬 LCP 1.7 s ×3、CLS 升到 0.11–0.13；(2) 關掉 modulepreload：模擬 LCP 1.4–2.0 s 波動更大、TTI 1.4 → 1.6 s。兩者都撤回。
- **未量測**：線上 GitHub Pages 網址（本 session 部署被權限擋下，見 PROGRESS）、實體手機。

## D14. /status：沒有資料庫的狀態紀錄與事故

- 每次 collect 先從線上站讀回上一份 `data/status.json`，把這次結果併進去再發布（`updateStatus`，純函式、有測試）。歷史因此跨部署累積，不需要資料庫或 commit 資料。讀不到上一份就從頭開始，並在 log 註明。
- **收集失敗不覆蓋好資料**：某 feed 這次失敗時，改發布線上的上一份快照（加註「最近一次收集失敗…，顯示上一份資料」），顯示時仍依年齡重新判定，過舊就不下結論。以前會直接用「無法取得」蓋掉。
- **事故判定**：收集失敗 → `collect-failed`；收集時狀態為 stale／unavailable → `stale`；恢復即結束。保留最近 300 次收集、100 筆已結束事故（進行中的永不丟）。
- `/status` 頁顯示：各 feed 現在狀態、官方資料時間、資料年齡、最近成功收集、最近一次嘗試、門檻、收集當下資料年齡的中位數／p95、收集間隔中位數／p95、事故清單。這也是第 1 階段說的「連續量測資料年齡」的落點。
- **限制**：只量得到「收集當下」的快照年齡；瀏覽器直接讀官方檔時的實際年齡沒有回傳管道（不做追蹤）。

## D15. LINE 分享

- **文字**：`https://line.me/R/share?text=…`（LINE 官方 URL scheme，開啟分享對象選擇），另有「複製文字」（剪貼簿失敗時顯示可長按複製的文字框）。每項都附狀態與資料時間；過舊項目分享的是「不做判斷」那句，不是舊值。
- **圖卡**：Canvas 自繪 1080×1350 PNG（不加套件）。支援 Web Share（含檔案）的手機直接叫出分享面板，其餘顯示圖片與下載連結。圖卡同樣每項附資料時間。

## D16. 部署替代方案

- 正式部署仍待使用者推上 Pages workflow（PROGRESS #1）。替代方案改成可重現的腳本 `scripts/deploy-gh-pages.sh`（collect → `build:public` 金鑰檢查 → 覆寫 `gh-pages` 分支）。本 session 執行此腳本被 Claude Code 自動模式判為「正式環境部署」而擋下，未繞過，列入 PROGRESS「需要使用者」。

## D17. 個別測站／時段也要 fail-closed（Codex 複核發現）

- **UV／AQI**：feed 的新鮮度取「最新的那一站」，停報的測站會跟著被當成即時。改為每個測站自己的觀測時間也要在該 feed 的 delayed 門檻內（UV 120 分、AQI 180 分），否則不採用、改用下一個最近站；全縣市都沒有近期觀測就寫「不推估／不做判斷」。
- **熱傷害**：現在這個時段沒有指數時，警示欄空白代表「沒資料」而不是「沒警示」，改為不做判斷。
- **降雨**：只看起點在未來 12 小時內的時段（原本若時段有缺口，可能拿到 12 小時後的預報）。
- 三項都有回歸測試。

---

# 第 3 階段（2026-10-16）

## D18. 電力 feed：台電機組＋供需，只能伺服器端收集

- **資料源**：`service.taipower.com.tw/data/opendata/apply/file/d006001/001.json`（各機組發電量即時資訊，**含外購電力**，data.gov.tw 8931）與 `…/d006020/001.json`（今日系統供需狀況，162595）。兩者的 data.gov.tw 名稱、下載連結、更新頻率（每 10 分）皆以 data.gov.tw API 讀 metadata 確認。
- **CORS 實測**：`curl -H 'Origin: https://livejiaquan.github.io'` → HTTP 200 但**沒有** `Access-Control-Allow-Origin`；OPTIONS 回 200 也沒有 CORS 標頭。瀏覽器不能直接讀，所以只能由 collect 步驟收集（與 AQI 同樣受 Actions 排程不準影響，D2）。
- **驗證**（沿用 taiwan-power-dashboard）：非小計機組 ≥ 100、可讀發電量比例 ≥ 98%、單機 −20,000～100,000 MW、`DateTime` 不得晚於現在 15 分；一次發電總量 5,000～60,000 MW。供需檔：燈號必須是 G/Y/O/R/B、負載合理；與機組檔時間差 > 60 分或「機組淨發電加總 ÷ 負載」不在 0.9–1.1 時**不採用供需檔**（機組資料照用，`issues` 註明）。供需檔讀取失敗也不影響碳強度。
- 台電檔開頭有 UTF-8 BOM；`Response.json()` 會自動去掉（有測試）。
- **新鮮度**：live ≤ 30 分、delayed ≤ 90 分（每 10 分更新）。過舊時 /today 不顯示目前碳強度。

## D19. 水庫 feed：水利署兩個 API、20 座主要水庫、逐座 fail-closed

- **資料源**：data.gov.tw 45501「水庫水情資料」（每小時，`opendata.wra.gov.tw/api/v2/2be9044c…`）＋ 41568「水庫每日營運狀況」（每日，提供有效容量）。兩者 HTTP 200、`ACAO: *`、免金鑰（實測），所以 /today 在快照不夠新時由瀏覽器直接讀（275 KB＋29 KB）。
- **範圍**：沿用 taiwan-reservoir-static 的 20 座主要水庫對照表（臺中市改用正式「臺」字）。少於 10 座即整份拒收。
- **未來時間**：實測 2026-10-16 01:4x 時，13 筆（識別碼 502xx）觀測時間是 07:00，比現在晚 5 小時以上。規則：晚於現在 15 分以上的列一律丟棄，再取每座最新一筆；`issues` 註明略過筆數。
- **逐座 fail-closed**：部分水庫每天只報一次（實測仁義潭、南化等最新為前一天 07:00）。收集時超過 48 小時的不收；顯示時再依「現在」判一次，超過 48 小時只顯示「資料過舊，不顯示」。
- **超過 100%**：阿公店水庫實測有效蓄水量 1,947 > 有效容量 1,480（131.5%）。照官方數字呈現、長條圖封頂，不自行修正。頁面註明「蓄水率不等於限水」（競品報告 §5.4）。
- **新鮮度**：feed 依最新一座的觀測時間，live ≤ 3 小時、delayed ≤ 12 小時。

## D20. 碳強度方法；綠電時段只用本站存檔

- **公式與係數**：見 `docs/METHODOLOGY-carbon.md`。主要指標為**生命週期**（可與 Electricity Maps 比較，競品報告 §8.2），同時提供**直接排放**（可與能源署公告係數對照）。係數照 Electricity Maps `config/defaults.yaml`（commit d9a920f）所整理的 IPCC 2014 等原始出處；汽電共生依其台電解析器視為「未知火力」。只引用數值，不使用其 AGPL 程式碼。
- **儲能不計入**分子與分母（放出的電在充電時已計），避免把儲能當 0 排放而低估。
- **合理性對照**：本站 01:40 瞬間值直接排放 472、生命週期 569 g/kWh；能源署 114 年度公用售電業係數 0.467 kg/度（🔎 新聞與搜尋結果，公告 PDF 未開啟）；Electricity Maps 台灣 2025 平均生命週期 463（✅ 設定檔）。深夜無太陽能，瞬間值高於年平均屬預期方向。
- **考慮過但不採用：用台電 d006010 算綠電時段基準**。d006010 是逐 10 分鐘的各機組歷史（2026-03-01～05-31，196 MB，下載 337 秒）。完整解析 2,048,976 列後發現**只含台電自有機組**：2026-04-15 12:00 太陽能 84 MW、沒有「民營電廠」與外購風光；算出的逐時碳強度 617–623 g 幾乎是平的，會讓人以為一天中沒有綠電時段。改為只用本站存檔（d006001 含外購電力）計算，最近 14 天、至少 48 筆、涵蓋 18 個小時才給出時段，否則顯示「樣本不足」與目前筆數。
- **代價**：在排程變準時之前（D2、PROGRESS「需要使用者」#1、#3），綠電時段要累積約一到兩週才會出現。

## D21. 歷史存檔：`data` 分支、一 feed 一天一檔、90 天

- **選項**：(1) 像 status.json 一樣每次從線上讀回再發布——90 天 × 7 feed 的檔案每次都要重新下載，失敗就丟歷史；(2) Cloudflare R2——需要使用者登入（PROGRESS #3）；(3) **repo 的 `data` 孤兒分支**，收集流程 commit 進去（競品報告 §8.1 第 2 點「GitHub Actions 只做 CI 與存檔 commit」、kiang/taipower_data 的作法）。選 (3)：git 歷史即備份、raw.githubusercontent.com 也能讀（實測 200、`ACAO: *`）、不需新帳號。
- **格式**：`v1/<feed>/<YYYY-MM-DD>.json`（台北日期；警特報依讀取時間，其餘依官方時間），`v1/index.json` 列出日期。同一官方更新只存一次（同 `sourceTime` **且內容相同**；警特報為內容與前一筆相同），所以收集失敗後重發的舊快照不會重複，而晚到的測站／水庫（`sourceTime` 取最新一站，可能不變）仍會被存下（D25）。既有日檔讀不到或格式不對時整個存檔步驟失敗，不會用新檔覆蓋歷史（D25）。熱傷害、降雨存「共用時間軸＋每鄉鎮一列」，UV 只存有紫外線讀值的測站，AQI／水庫存表格，警特報與電力存原樣。
- **大小實測**：第一次存檔 7 個 feed 共 8 個檔 64 KB（熱傷害 23.5 KB、降雨 12 KB、其他 1–8 KB）。即使改成每 10 分鐘收集，估計每天 < 1.5 MB。
- **保留**：分支最新版只留最近 90 個台北日（`splitRetention`，有測試），更舊的在 git 歷史；`archive` 步驟同時把 `v1/` 鏡像進網站（`archive/v1/…`）。
- **自動化**：`pages.yml` 在 collect 之後 checkout `data` → `npm run archive` → commit／push（`contents: write`），再建置部署。這個 workflow 變更與 D2 的 workflow 一樣卡在 gh token 沒有 `workflow` 權限（PROGRESS #1）；在那之前 `scripts/deploy-gh-pages.sh` 每次部署也會存檔。

## D22. 開放 JSON API：靜態檔＋文件，不另做網頁版文件

- API 就是 GitHub Pages 上的靜態 JSON（`data/*.json`、`archive/v1/*`），實測 `Access-Control-Allow-Origin: *`、`Cache-Control: max-age=600`。新增 `data/catalog.json`（機器可讀目錄：路徑、來源、授權、新鮮度門檻）給 MCP／Home Assistant 用。
- 文件只寫一份 `docs/API.md`（GitHub 上直接可讀），網站頁尾連過去；不在網站另做一份 HTML 文件，避免兩份不同步。
- 版本規則：`schemaVersion: 1` 內只新增欄位；不相容時換路徑（`archive/v2/`）。
- 文件第一條規則就是「不要相信檔案裡的 `status`，請依門檻重算」，並附重算程式碼。

## D23. 「今天的台灣」放獨立頁 `/today/`

- 版面位移：第一版線上 Lighthouse CLS 0.548（電力區塊從「讀取中」長到 510 px，把下方區塊推下去）。改為讀取中先預留載入後的高度（手機 32rem、寬螢幕 28rem；水庫 52rem／50rem，實測 360–412 px 寬為 510／815–836 px），把高度最不固定的「綠電時段」放最後，方法說明在載入後才畫，本機正式建置 3 次 CLS 0.033。
- 不放在首頁下方：首頁有第 2 階段的效能預算（LCP ≤ 1.5 s、首屏 JS ≤ 150 KB）。獨立頁同樣預先渲染＋hydration；首頁只在頁尾加連結。新增後首頁首屏 JS 約 92.6 KB gzip（build 輸出：共用 chunk 85.07＋main 6.85＋load 0.69）。
- 圖表不加套件：能源別占比、蓄水率、逐時碳強度都用 CSS 長條；逐時數值另有 `<details>` 表格給螢幕閱讀器。

## D24. workflow commit 推不上去時的推送方式

- 本機 `main` 的 workflow commit（f3df6de、291c625）因 token 缺 `workflow` 權限無法推送。本 session 想把它們移到最上面再推，`git reset --hard` 被 Claude Code 自動模式判為破壞性操作擋下（未繞過）。
- 改用不改寫本機歷史的作法：在獨立 worktree 的 `publish` 分支從 `origin/main` cherry-pick 非 workflow 的 commit 推上 `main`。結果本機 `main` 與 `origin/main` 內容相同但 commit 不同（分岔）；使用者補完 `workflow` 權限後執行 `git pull --rebase`，git 會自動略過內容相同的 commit，只剩兩個 workflow commit 在最上面，再 `git push` 即可。

## D25. Codex 獨立複核（第 3 階段）

Codex 從同一份即時官方檔獨立重算，結果與本站一致：碳強度生命週期 570／直接 473 g/kWh（本站 parser 同值）、係數與 Electricity Maps `defaults.yaml@d9a920f` 18 項比對 0 不符、水庫 5 座蓄水率逐一相符並確認 13 筆未來時間列被略過。它的沙箱無法執行 vitest（暫存目錄 `EPERM`），測試數以本機為準。

程式審查提出 4 個問題，主 session 逐一對照程式碼確認成立並修正（皆有回歸測試）：

| 問題 | 情境 | 修正 |
|---|---|---|
| 「目前負載」沒有自己的期限 | 機組資料 89 分前（delayed）、供需檔 148 分前，兩者相差 < 60 分 → 仍顯示「目前負載」 | 供需檔本身超過 90 分就不顯示該行 |
| 存檔只用 `sourceTime` 去重 | 晚到的水庫更新了，但全體最新時間沒變 → 新資料沒存 | 同 `sourceTime` 且內容完全相同才算重複 |
| 綠電時段 profile 沒有期限 | 收集停了幾天，舊 profile 仍標「最近 14 天」並拿來比較 | 最新樣本超過 3 天就不使用，改顯示原因 |
| 既有日檔壞掉會被覆蓋 | 讀檔或 JSON 解析失敗被當成「沒有檔案」，寫回只有一筆的新檔 | 只有「檔案不存在」才當新檔；其他錯誤讓存檔步驟失敗 |

## D26. 判讀邏輯抽成 `packages/assess`（第 4 階段）

- **背景**：MCP server 要回答「出門前」與「今天的台灣」，判讀邏輯原本在 `apps/web/src/assess.ts`、`today/today.ts`、`load.ts`（`pickBest`）與 `App.tsx`（卡片順序、fail-closed 文字）。PLAN：「不要重寫已經測過的邏輯」。
- **決定**：用 `git mv` 把這些純函式搬到新 workspace `packages/assess`（`assess.ts`、`today.ts`、`pick.ts`、`card.ts`），網站與 MCP 都從這裡 import。行為不變：搬移後原有 74 個測試照過，`today.test.ts` 隨檔案搬到 `packages/assess/test/`。
- **取捨**：多一個套件；換來同一筆資料在網站與 MCP 一定得到同一個結論（例如 AQI 普通在兩邊都「不點名」）。

## D27. MCP server：讀資料的順序、輸出形式、打包

- **讀資料順序**（`packages/mcp-server/src/data.ts`）：先讀網站快照，依「現在」重算狀態；不是即時（或雨量快照沒涵蓋該縣市）就在使用者電腦上**直接讀官方資料**，用的是和收集器同一份 parser 與驗證（`collectAny`）。兩者用 `pickBest` 取現在狀態較好的。本機沒有 CORS 限制，所以 AQI 與台電也能直接讀——這讓 MCP 不受 Actions 排程不準的影響（D2）。AQI 直接讀時用環境部刊登在 data.gov.tw 的公開下載連結（D3），使用者可設自己的 `MOENV_API_KEY`，金鑰只留在本機。可用 `TAIWAN_LIFE_DATA_DIRECT=0` 關掉直接讀。
- **不做的事**：沒有鄉鎮時不讀雨量（會是 22 個約 1 MB 的檔）；失敗的讀取不快取（快取 2 分鐘只為了同一段對話不重抓）。
- **輸出**：每個工具回傳繁中純文字（markdown），每項都有狀態、資料時間、資料年齡、取得方式、官方資料集；過舊／無法取得時用與網站相同的 fail-closed 句子，不出現任何數值。沒有用 `structuredContent`／`outputSchema`：資料本身已有開放 JSON API，工具的價值在「判讀＋出處」，純文字對模型最不容易誤讀。輸入錯誤（找不到鄉鎮、名稱重複）回 `isError` 並列出可選項，讓模型自己修正。
- **工具**：`outdoor_brief`、`list_towns`、`grid_carbon`、`reservoirs`、`data_status`、`history`，全部標 `readOnlyHint`。鄉鎮可省略縣市（全台唯一時）、接受台／臺與省略「區鄉鎮市」。
- **打包**：esbuild 把 SDK、zod 與 workspace 套件打成單一 `dist/index.js`（523 KB，壓縮後 tarball 157 KB），套件**沒有執行期依賴**，`npx` 啟動快、不受相依套件版本漂移影響。套件名 `taiwan-life-data-mcp`（2026-10-16 查 npm 尚未被使用）。
- **版本**：`@modelcontextprotocol/sdk` 1.32.1。

## D28. npm 發佈：未登入時改用 GitHub Release tarball

- **背景**：PLAN 要求「npm 可安裝」。本機 `npm whoami` 失敗（未登入），發佈需要使用者的 npm 帳號（PROGRESS「需要使用者」#5）。
- **決定**：先把 `npm pack` 的同一份 tarball 掛在 GitHub Release `mcp-v0.1.0`，安裝指令 `npx -y --package=<release tarball URL> taiwan-life-data-mcp`——這仍是 npm 安裝（npm 支援 tarball URL），使用者登入後 `npm publish` 即可改成 `npx -y taiwan-life-data-mcp`，內容不變。README 兩種指令都列。
- **實測踩到的坑**：`npx -y <tarball 路徑>` 會被當成要執行該檔（`Permission denied`），Claude Code 顯示 MCP 連線失敗；必須用 `--package=<tarball> <bin 名稱>`。

## D29. `/status` 自動事故紀錄延伸

- **新增「收集中斷」**（`collect-gap`，範圍 `collector`）：兩次收集相隔超過 60 分鐘（排程目標每 15 分）。收集器停擺時無法記錄自己，所以檔案裡只會在下一次收集到來時補記一筆已結束的中斷；**進行中的中斷由讀取端計算**（`openCollectGap`，`/status` 頁與 MCP 共用）。依 D2 的實測，Actions 排程上線後這類事故會很多——這是實情，照實記錄，也是 Workers Cron（PROGRESS #3）的量化理由。
- **事故內容**：加 `lastSeenAt`、`runs`、`worstAgeMinutes`（選填，舊的 `status.json` 仍可讀）；驗證改為逐欄檢查（未知的 kind 或 feed 會被拒絕）。
- **公開管道**：`data/incidents.xml`（Atom，最近 50 件，id 用 `${feed}/${kind}/${startedAt}`）、`archive/v1/incidents.json`（長期紀錄，`status.json` 只留 100 件；保留 90 天、進行中永遠保留；壞檔停止存檔，不覆蓋）。
- **不做**：「部分失敗」（例如 22 個雨量檔中 1 個失敗）目前只寫在 feed 的 `issues`，不另立事故——判定規則需要逐 feed 設計，等累積實際資料再決定。

## D30. README：兩個檔案、真實截圖、mermaid 架構圖

- **雙語**：`README.md`（繁中，預設）＋ `README.en.md`，頂端互相連結。一個檔案放兩種語言會讓每一節長一倍、兩邊容易不同步；分檔後各自完整。
- **截圖**：線上網站實際畫面（`docs/screenshots/`）。用 headless Chrome `--window-size=390,…` 擷取時，新版 headless 視窗有最小寬度，實際排版比 390 px 寬、右側被裁掉——改用 DevTools Protocol 的裝置模擬（390×844、DPR 2、mobile）擷取全頁，`scrollWidth=390` 確認沒有橫向溢出。
- **架構圖**：mermaid（GitHub 直接渲染、跟著程式碼改），不放圖片檔。

## D31. Commit 仍不加 AI 協作標記

- 本階段 Claude Code 的預設提示要求在 commit 結尾加 `Co-Authored-By`；PLAN 技術約束與 D9 明確禁止，以使用者的 PLAN 為準，不加。

## D32. Codex 獨立複核（第 4 階段）

Codex（唯讀沙箱）審查 `9e6fc85..c3d6e32`，用記憶體內腳本實際重現。主 session 逐一對照程式碼確認成立並修正，每項都有回歸測試（修正前 4 個測試失敗、修正後通過）：

| 問題 | 情境 | 修正 |
|---|---|---|
| MCP 判讀用的是讀取當下的狀態 | 警特報讀到時是「延遲」，等其他較慢的來源時超過 60 分鐘，仍回答「目前沒有警特報」 | 所有讀取完成後，用回答當下的時間重新判定（`regrade`）；`grid_carbon`、`reservoirs` 同樣處理 |
| 官方讀取失敗被快取 2 分鐘 | collector 失敗是「成功回傳 unavailable」，快取只清掉 rejected 的 Promise | 失敗改為 reject，不進快取 |
| `pickBest` 平手時只比 `sourceTime`（第 2 階段既有） | 警特報快照與官方檔 `sourceTime` 相同、都延遲，會留下讀取較早的快照 | 平手時依 feed 的新鮮度基準比較（警特報用 `retrievedAt`）；網站同時受益 |
| 長事故結案後立刻從長期紀錄消失（Codex 列為「符合明訂規則」，主 session 判斷規則本身不對） | 開始超過 90 天才結案的事故 | 改依結束時間保留 |

Codex 確認無問題的項目：快取不會讓過期資料被當成新的（每次重新判定）、沒有鄉鎮時不讀 22 個雨量檔、錯誤訊息不會帶出含 `api_key` 的網址、事故 Atom 跳脫、舊格式 `status.json` 仍可讀、抽出 `packages/assess` 後 `assess.ts` 與舊版逐位元組相同、`npx --package=<tarball URL>` 語法正確。它無法驗證 GitHub 上 mermaid 的實際渲染（當時尚未推送），改由主 session 推送後確認。
