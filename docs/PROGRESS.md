# 進度（PROGRESS）

（「需要使用者」#1 推上 workflow 時注意：本機 `main` 與 `origin/main` **內容相同但已分岔**——本機多兩個 workflow commit，而第 3 階段的 commit 是用 cherry-pick 推上去的（DECISIONS D24）。順序：`gh auth refresh -h github.com -s workflow` → `git pull --rebase`（git 會自動略過內容相同的 commit）→ `git push`。）

## 需要使用者

| # | 要做的事 | 為什麼 | 怎麼做 | 目前替代方案 |
|---|---|---|---|---|
| 1 | **給 gh token 加 `workflow` 權限，推上 workflow commit** | 現有 OAuth token 只有 `gist, read:org, repo`，GitHub 拒絕推送 `.github/workflows/*`。沒有 workflow 就沒有 CI、排程收集，**存檔也不會自己每天累積**（第 3 階段的存檔步驟寫在 `pages.yml`）。 | 在本 repo：`gh auth refresh -h github.com -s workflow`（瀏覽器授權）→ `git pull --rebase` → `git push` → `gh api -X PUT repos/livejiaquan/taiwan-life-data/pages -f build_type=workflow`（Pages 改由 workflow 部署） | 執行 `./scripts/deploy-gh-pages.sh`：collect → 存檔 commit 到 `data` 分支 → 金鑰檢查建置 → 覆寫 `gh-pages`。本 session 已用它部署兩次。 |
| 2 | 設定 GitHub secret `MOENV_API_KEY` | PLAN 指定 AQI 走自己的金鑰 | 到 https://data.moenv.gov.tw/ 申請 API key → `gh secret set MOENV_API_KEY -R livejiaquan/taiwan-life-data` | collector 改用環境部刊登在 data.gov.tw 的公開下載連結（執行時解析，不入庫、不進瀏覽器），見 DECISIONS D3 |
| 3 | `npx wrangler login`（Cloudflare 帳號） | AQI 與**台電**（不允許跨網域，D18）都只能伺服器端收集；要達到 p95 ≤ 30 分、讓綠電時段快速累積樣本，需要準時排程（Actions 實測間隔中位數 2–5 小時，D2） | 執行 `npx wrangler login`，完成後告訴下一階段 session，由它建立 Workers Cron | 見 #1；電力過 90 分鐘即不顯示目前碳強度 |
| ~~4~~ | ~~把第 2 階段部署上線~~ | — | **已完成**：使用者 2026-10-16 01:38 執行部署腳本；本 session 02:04、02:11 再部署第 3 階段（gh-pages `ab05502`、`cc55d78`） | — |

## 階段 3 今天的台灣＋API — 狀態：完成（「每天自動」待使用者 #1）

### 做了什麼
- **電網碳強度**（新 feed `power`）：台電 d006001（各機組發電，含外購）＋ d006020（負載、備轉、燈號），伺服器端收集（台電不送 CORS 標頭，D18）。能源別加總 → 生命週期與直接排放兩種碳強度、低碳／再生占比；儲能不計入；與負載交叉檢查。
- **方法公開**：`docs/METHODOLOGY-carbon.md`——公式、機組類型對照、每個係數的原始出處（IPCC 2014 等，依 Electricity Maps `defaults.yaml@d9a920f` 取值）、與能源署官方係數的對照、誤差與限制（D20）。
- **綠電時段**：由本站存檔最近 14 天的碳強度樣本，找台北時間平均最低的連續 3 小時；樣本不足（< 48 筆或 < 18 個小時）或最新樣本超過 3 天就不推估、照實寫原因。評估過用台電 d006010 季歷史當基準，實測只含台電自有機組（中午太陽能 84 MW）、算出的曲線幾乎全平，不採用（D20）。
- **水庫**（新 feed `reservoir`）：水利署 45501＋41568（瀏覽器可直接讀），20 座主要水庫蓄水率；未來時間列丟棄、逐座 48 小時 fail-closed、超過 100% 照實呈現（D19）。
- **「今天的台灣」頁 `/today/`**：碳強度＋能源別占比＋負載／燈號、水庫（北中南）、綠電時段；預先渲染＋hydration、讀取中預留高度；首頁頁尾連結（D23）。
- **開放 JSON API＋文件**：`docs/API.md`（端點、FeedEnvelope、各 feed 型別、新鮮度門檻與重算程式碼、存檔格式、範例、穩定性承諾）；新增 `data/catalog.json` 機器可讀目錄（D22）。
- **歷史存檔**：`data` 孤兒分支，每個 feed 每個台北日一檔、同一官方更新只存一次、保留 90 天（更舊的在 git 歷史）、鏡像到網站 `archive/v1/`；`pages.yml` 每次收集後自動 commit，部署腳本也會存檔（D21）。
- `/status` 自動納入兩個新 feed；說明文字區分「需金鑰」與「不允許跨網域」。

### 驗收證據

| 驗收項 | 結果 | 證據 |
|---|---|---|
| 碳強度方法與係數出處寫進 docs | ✅ | `docs/METHODOLOGY-carbon.md`；Codex 從 Electricity Maps 原檔逐項比對 18 項 0 不符；Codex 自寫 Python 從同一份台電即時檔重算 570／473 g/kWh，與本站 parser 相同 |
| API 文件可用 | ✅ | `docs/API.md`（GitHub 上可讀）；文件中所有網站端點線上 HTTP 200、`access-control-allow-origin: *`（下方輸出）；`data` 分支 raw 鏡像 200 |
| 存檔每天自動累積 | ⚠️ 機制完成且線上在累積；**排程觸發待使用者 #1** | `data` 分支已有 3 個 commit（初始＋兩次部署自動 commit）；去重實測正確（第二次部署：warnings／heat／rain 判重複，aqi／power／reservoir 新增）；90 天保留、日期歸檔、去重、壞檔不覆蓋都有單元測試。每天自動觸發需要 workflow 推上去（token 缺 `workflow` 權限）；在那之前每次執行部署腳本會累積一次。**未實測跨日累積**（本 session 全部在 10/16 當天） |

本機檢查（2026-10-16 02:1x +08，修正 Codex 發現後）：
```
$ npm run lint        → 無錯誤
$ npm run typecheck   → 無錯誤
$ npm test
 Test Files  7 passed (7)
      Tests  74 passed (74)
$ npm run build:public
prerendered index.html / status/index.html / today/index.html
Public artifacts checked (28 files): no credential markers or key-requiring API URLs.
```

部署（`./scripts/deploy-gh-pages.sh`）。第一次（02:04）收集輸出：
```
power    live        ok=true source=2026-10-15T17:50:00.000Z age=14m bytes=1142
reservoir live        ok=true source=2026-10-15T17:00:00.000Z age=64m bytes=3426 issues=略過 13 筆觀測時間在未來的資料
deployed ab05502
```
第二次（02:11，修正 Codex 發現後）存檔輸出：
```
status: 3 runs, 0 open incidents
archive warnings  duplicate → 2026-10-16 (1 samples)
archive aqi       added → 2026-10-16 (2 samples)
archive power     added → 2026-10-16 (3 samples)
archive reservoir added → 2026-10-16 (2 samples)
power-profile: 3 samples; 樣本 3 筆，少於 48 筆
deployed cc55d78
$ git log origin/data
f7786fe 2026-10-16 02:11:43 +0800 Archive 2026-10-15T18:11Z
daf218a 2026-10-16 02:04:24 +0800 Archive 2026-10-15T18:04Z
13ef5d1 2026-10-16 02:00:55 +0800 Start the history archive
```

線上端點（02:0x，`curl`）：
```
200 /            200 /today/        200 /status/
200 /data/catalog.json  200 /data/power.json  200 /data/reservoir.json  200 /data/power-profile.json
200 /archive/v1/index.json  200 /archive/v1/power/2026-10-16.json
access-control-allow-origin: *
raw.githubusercontent.com/livejiaquan/taiwan-life-data/data/v1/index.json → 200
```

線上 Lighthouse（12.8.2，mobile 模擬降速，02:1x，gh-pages `cc55d78`）：
```
page                          a11y perf  LCP_ms  CLS    JS_bytes
today/                        100  100   1006    0.03   91285
?county=臺南市&town=安南區      100  100   1003    0.002  94035
status/                       100  100    842    0.04   89149
```
（第一版 /today 線上 CLS 0.548，修正見 D23；第 2 階段要求的首頁 LCP ≤ 1.5 s、首屏 JS ≤ 150 KB、a11y ≥ 95 在加入新頁後仍成立，且這次是**線上**量測。）

線上畫面（headless Chrome 390×844，`/today/`）：碳強度「目前每度電約 568 公克 CO₂e」＋能源別 8 項占比＋負載 27,142 MW／燈號 G；水庫 20 座分北中南、各自資料時間；綠電時段「樣本不足（目前累積 2 筆）」。

獨立複核（Codex，唯讀）：碳強度重算、係數 18 項、5 座水庫蓄水率皆與本站一致；其沙箱無法執行 vitest（暫存目錄 `EPERM`），測試數以本機為準。審查提出 4 個問題，主 session 對照程式碼確認成立並全部修正＋回歸測試（D25）：「目前負載」沒有自己的期限、存檔只用 sourceTime 去重會漏存晚到的水庫、profile 沒有期限、壞掉的日檔會被覆蓋。

### 未完成／已知限制
- **存檔排程**待 #1；**跨日累積尚未實測**（明天第一次收集會建立 10/17 的檔）。
- **綠電時段目前顯示「樣本不足」**：需要 48 筆、18 個小時，依現在的收集頻率要一到兩週；#1、#3 完成後會快很多。
- 台電資料只能伺服器端收集，排程不準時 /today 的碳強度常會是「過舊、不顯示」（誠實但不好用），根治靠 #3。
- 能源署 114 年度官方係數 0.467 只從新聞與搜尋結果取得（公告頁已開但 PDF 未開），在方法文件標為 🔎。
- 碳強度與 Electricity Maps 台灣即時值的差距**未比較**（其台灣頁 Cloudflare 擋，競品報告 §4.1 UNVERIFIED）。
- 實體手機仍未測。

### 下一步（階段 4）
- MCP server（npm 套件）：直接吃 `data/catalog.json` 與 `docs/API.md` 的契約；README 雙語＋截圖＋架構圖；`/status` 自動事故紀錄延伸到新 feed（已自動納入，事故分類可再細）。

## 階段 2 出門前 — 狀態：完成（使用者已於 2026-10-16 01:38 部署上線）

### 做了什麼
- **368 鄉鎮選擇**：從氣象署 M-A0085-001 產生 368 鄉鎮清單（geocode＋中心點）入庫；縣市 → 鄉鎮市區兩層原生選單；`?county=&town=` 可分享、本機記住上次地點、相容第 1 階段 `?county=` 連結（DECISIONS D10）。
- **首頁「出門前」卡（鄉鎮級）**：摘要列（點名需要留意的項目、無法判斷的項目照實寫出）→ 警特報（縣市發布，標子區域）→ 熱傷害（該鄉鎮官方指數）→ 紫外線／氣溫（同縣市最近 UV 站＋距離；氣溫優先同鄉鎮測站）→ 空品（同縣市最近測站＋縣市最高）→ **降雨（新 feed，該鄉鎮未來 12 小時 3 小時降雨機率）**。每項都有狀態徽章、資料時間、資料年齡、取得方式、官方資料集連結（D11、D12）。
- **/status 頁**：各 feed 現在狀態、官方資料時間、資料年齡、最近成功收集、最近一次嘗試、門檻、收集當下資料年齡中位數／p95、收集間隔中位數／p95、事故清單；`data/status.json` 每次收集自動累積（讀回線上上一份，不需資料庫）。收集失敗時改發布上一份好快照而不是用「無法取得」覆蓋（D14）。
- **LINE 分享**：「傳到 LINE」（`line.me/R/share`）、「複製文字」、「產生圖卡」（Canvas 1080×1350 PNG；手機走 Web Share、其餘可下載），文字與圖卡每項都附狀態與資料時間（D15）。
- **手機版與效能**：手機優先版面（44–48 px 觸控目標、≤22rem 單欄）；建置時預先渲染首屏＋內嵌 CSS＋hydration，LCP 不等 JS（D13）。
- **部署腳本**：`scripts/deploy-gh-pages.sh`（D16）；本 session 執行被權限擋下，見「需要使用者」#4。

### 驗收證據

| 驗收項 | 結果 | 證據 |
|---|---|---|
| 368 鄉鎮皆可選 | ✅ | 單元測試（368 個 geocode 唯一、每個都能從 URL 還原）＋ headless Chrome 實際操作選單逐一選 368 個鄉鎮，0 問題（下方輸出） |
| 4G 降速中階手機 LCP ≤ 1.5 s | ✅ 中位數達標；⚠️ 模擬 8 次中 3 次超標；**線上未量** | DevTools 實際降速 3/3：0.64–0.65 s；lantern 模擬 8 次：1.35–1.36 s ×5、1.54／1.66／1.81 s（中位數 1.36 s，超標原因見 D13）。量測對象是本機正式建置，不是線上網址 |
| 首屏 JS ≤ 150 KB gzip | ✅ | Lighthouse 量到首頁 Script 傳輸 89,502 B（main＋共用 chunk，gzip） |
| Lighthouse a11y ≥ 95 | ✅ 100 | 首頁與 /status、兩種降速模式全部 100 |
| 附報告 | ✅ | `docs/reports/phase2/`：首頁 DevTools 降速、首頁模擬降速、/status DevTools 降速 HTML 報告＋全部 13 次的 `lighthouse-runs.json` |

Lighthouse 條件：12.8.2、mobile（Moto G Power 模擬）、RTT 150 ms、1.6 Mbps、CPU 4×；對象為 `vite preview`（gzip）提供的正式建置，網址 `?county=臺南市&town=安南區`。

```
run            throttling  lcp_ms fcp_ms a11y  cls   js_bytes
i-dt-home-1    devtools      643   643  100  0.017  89502
i-dt-home-2    devtools      648   648  100  0.017  89502
i-dt-home-3    devtools      646   646  100  0.017  89502
i-dt-status    devtools      684   684  100  0.04   85191
i-home-1       simulate     1353  1353  100  0.021  89502
i-home-2       simulate     1358  1358  100  0.021  89502
i-home-3       simulate     1658  1354  100  0.021  89502
i-home-4       simulate     1810  1354  100  0.021  89502
i-home-5       simulate     1354  1354  100  0.021  89502
i-home-6       simulate     1353  1353  100  0.021  89502
i-home-7       simulate     1541  1386  100  0.021  89502
i-home-8       simulate     1354  1354  100  0.021  89502
i-status       simulate     1354  1354  100  0.04   85191
```

368 鄉鎮端對端（headless Chrome，390×844，實際操作兩個選單；每次確認摘要列地名、URL 帶 `town=`、5 個區塊都不是「讀取中」或「沒有這個地區的資料」）：
```
{"基隆市":7,"臺北市":12,"新北市":29,"桃園市":13,"新竹市":3,"新竹縣":13,"苗栗縣":18,"臺中市":29,"彰化縣":26,"南投縣":13,"雲林縣":20,"嘉義市":2,"嘉義縣":18,"臺南市":37,"高雄市":38,"屏東縣":33,"宜蘭縣":12,"花蓮縣":13,"臺東縣":16,"澎湖縣":6,"金門縣":6,"連江縣":4}
counties=22 townships checked=368 problems=0
```

本機檢查（2026-10-16 01:1x +08）：
```
$ npm run lint        → 無錯誤
$ npm run typecheck   → 無錯誤
$ npm test
 Test Files  4 passed (4)
      Tests  50 passed (50)
$ npm run collect
status: no previous status.json on the live site; history starts now
warnings live        ok=true source=2026-10-15T08:26:24.000Z age=0m
uv       live        ok=true source=2026-10-15T16:40:00.000Z age=20m
heat     live        ok=true source=2026-10-15T14:00:54.000Z age=179m
aqi      live        ok=true source=2026-10-15T16:00:00.000Z age=60m issues=使用 data.gov.tw 公開下載連結（尚未設定 MOENV_API_KEY）
rain     live        ok=true source=2026-10-15T15:00:00.000Z age=120m
status: 1 runs, 0 open incidents
$ npm run build:public
prerendered index.html / status/index.html
Public artifacts checked (13 files): no credential markers or key-requiring API URLs.
```

畫面實測（headless Chrome 390×844）：首頁 5 區塊皆有結論、console 0 錯誤；「傳到 LINE」連結內文含 5 項狀態與資料時間；「產生圖卡」產出 1080×1350 PNG（每項附資料時間）；/status 正常顯示 5 個 feed 與收集紀錄。

獨立複核（Codex，從 GitHub 下載 `fa89d0b` 的 archive——其環境無法解析 github.com，git clone 失敗；npm 改以預先下載的 tarball 離線安裝）：
- `npm run lint`／`typecheck` 通過；`npm test`：`Test Files 4 passed (4) / Tests 50 passed (50)`。`npm run build:public` 在其沙箱因 tsx 無法建立 IPC socket（`listen EPERM`）失敗，分段改跑後 vite 建置、prerender、產物掃描皆通過——**這是環境限制，但原指令在該環境記為失敗**。
- 從官方 M-A0085-001 重新數：`OFFICIAL_COUNT=368 / TOWNS_TS_COUNT=368 / 兩邊缺漏 0`。
- 22 個降雨檔逐檔：HTTP 200、`ACAO: *`、`LocationsName` 全吻合、鄉鎮數全吻合（`RAIN_FILES_VERIFIED=22 NAME_MISMATCHES=0 COUNT_MISMATCHES=0`）。
- 程式審查找到 3 個問題，主 session 逐一對照程式碼確認成立並修正（DECISIONS D17）：UV／AQI 停報測站會隨 feed 被當成即時、熱傷害當前時段無指數時誤判「沒有警示」、降雨可能取到 12 小時以外的時段。修正後重跑測試 50/50、368 鄉鎮端對端 0 問題、上表 Lighthouse 為修正後數據。
- 未發現：stale／unavailable 仍下結論的路徑、跨鄉鎮誤用資料、`updateStatus` 事故開關錯誤、金鑰寫入公開檔的路徑。

### 未完成／已知限制
- **線上仍是第 1 階段**（#4）；線上 Lighthouse 未量。
- 降雨的發布節奏採官方說明「一天 4 次」（搜尋摘要，PDF 本文未開啟），下一次實際發布時間未實測（D11）。
- UV 快照的 live 窗只有 25 分，Actions 排程又不準，首頁幾乎每次都會直接讀 669 KB 的 O-A0003-001（D7 的代價仍在；要靠 Workers Cron 產出瘦身檔才能解，待 #3）。
- /status 只量得到收集當下的快照年齡；瀏覽器直接讀官方檔時的年齡沒有回傳（不做追蹤）。
- 實體手機未測（只有 Lighthouse 模擬與 headless Chrome）。

### 下一步（階段 3）
- 電網碳強度＋綠電時段（方法與係數出處寫進 docs）、水庫、公開 JSON API＋文件、歷史存檔。`status.json` 的「讀回上一份再累積」作法可直接延伸成每日存檔。

## 階段 1 基礎 — 狀態：完成（CI 綠燈待使用者 #1）

### 做了什麼
- **Monorepo**（npm workspaces）：`packages/contract`、`packages/collectors`、`apps/web`；ESLint（flat config＋typescript-eslint）、`tsc --noEmit`、Vitest。
- **資料契約** `packages/contract`：`FeedEnvelope { sourceTime, retrievedAt, status: live|delayed|stale|unavailable, via, source{agency,title,datasetId,url,license}, issues, data }`；每 feed 新鮮度政策；`computeStatus`／`currentStatus`（fail-closed，顯示時依現在重算）；`parseEnvelope` 結構驗證＋金鑰字樣攔截；`parseOfficialTime` 處理官方各種時間格式（含 `+8:00`、`2026/10/16 00:00:00`）。
- **Collectors**（搬入舊 repo 已測過的邏輯，並各有離線 fixture 測試）：
  - 警特報 W-C0033-001：沿用 weather-risk 站的嚴格驗證（22 縣市＋geocode 必須完全吻合，缺縣市不得當作「無警報」），過期 hazard 在顯示時過濾。
  - UV／氣溫 O-A0003-001：沿用 UV 站的解析與 -99 哨兵值處理。
  - **熱傷害 M-A0085-001（data.gov.tw 143330）**：新接，368 鄉鎮全量驗證，快照只留未來 48 小時。
  - AQI AQX_P_432：沿用 AQI 站的驗證門檻（≥80 站、22 縣市、有效比 ≥0.95、siteid 唯一、未來時間容忍 15 分）；取得金鑰網址的程式只在 `src/server.ts`。
- **新鮮度方案實測與決定**：見 `docs/DECISIONS.md` D2（CORS／延遲表、Actions cron 實際間隔表、決定與理由）。
- **公開建置防金鑰**：沿用 `assertPublicBuildEnv`＋輸出掃描（`scripts/build-public.ts`），第一次建置即攔下前端帶到 AQI 網址程式的問題並修正（D6）。
- **最小可用頁**：選縣市 → 警特報 → 熱傷害 → 紫外線 → 空品（降雨標示建置中），每項顯示狀態、官方資料時間、取得時間、取得方式（快照／直接讀官方檔）與資料集連結；`?county=` 可分享。
- **CI／部署 workflow**：`.github/workflows/ci.yml`（lint、typecheck、test、build:public）、`pages.yml`（collect → build:public → Pages）已寫好並 commit 在本機，待使用者 #1 推上。
- **GitHub repo**：https://github.com/livejiaquan/taiwan-life-data（public，MIT）。

### 驗收證據

| 驗收項 | 結果 | 證據 |
|---|---|---|
| 測試全過 | ✅ | 下方「本機檢查」輸出：4 檔 34 測試全過 |
| CI 綠 | ⏳ **未達成**，卡在使用者 #1 | 本機以 CI 相同指令跑過全綠；GitHub 上尚無 workflow，無法跑 |
| 線上網址 HTTP 200 | ✅ | `curl` → `index 200 997B`；`data/index.json 200`；headless Chrome 實際渲染（下方） |
| DECISIONS 有各端點 CORS／延遲實測數據 | ✅ | `docs/DECISIONS.md` D2 兩張表 |

本機檢查（2026-10-16 00:29 +08）：
```
$ npm run lint        → eslint .（無輸出＝無錯誤）
$ npm run typecheck   → tsc --noEmit -p tsconfig.json（無錯誤）
$ npm test
 Test Files  4 passed (4)
      Tests  34 passed (34)
$ npm run collect
warnings live        source=2026-10-15T08:26:24.000Z bytes=1819
uv       live        source=2026-10-15T16:20:00.000Z bytes=51318
heat     live        source=2026-10-15T14:00:54.000Z bytes=388246
aqi      live        source=2026-10-15T16:00:00.000Z bytes=13636 issues=使用 data.gov.tw 公開下載連結（尚未設定 MOENV_API_KEY）
$ npm run build:public
dist/assets/index-BMgHl8eQ.js   240.21 kB │ gzip: 76.57 kB
Public artifacts checked (8 files): no credential markers or key-requiring API URLs.
```

線上（2026-10-16 00:34 +08）：
```
$ curl -s -o /dev/null -w 'index %{http_code} %{size_download}B\n' https://livejiaquan.github.io/taiwan-life-data/
index 200 997B
$ headless Chrome --dump-dom '…/taiwan-life-data/?county=臺南市'（節錄）
天氣警特報 即時 目前沒有生效中的天氣警特報 資料時間 10/15 16:26・取得 10/16 00:33（快照）
熱傷害指數 即時 現在沒有熱傷害警示 37 個鄉鎮市區的官方熱傷害預報（逐 3 小時）
紫外線與氣溫觀測 即時 紫外線 0（低量級） 臺南測站 10/16 00:20 觀測
空氣品質指標 即時 AQI 最高 74（普通） 林森測站 … 本縣市 5 個測站
```

瀏覽器直接讀官方檔（方案 a）線上實證（2026-10-16 00:50 +08，快照取得已超過 15 分）：
```
天氣警特報 即時 目前沒有生效中的天氣警特報 資料時間 10/15 16:26・取得 10/16 00:50（直接讀官方檔案）
```
同一次渲染發現 UV 快照 30 分鐘舊仍判為 live（門檻 40 分）→ 已下修為 25 分（DECISIONS D5）。

獨立複核：
- **Fresh clone**（從 GitHub 重新 clone main 到暫存目錄）：`npm ci` → lint、typecheck 無錯；`Test Files 4 passed (4) / Tests 34 passed (34)`；`build:public` 通過。
- **gh-pages 全檔掃描**：金鑰樣式（`api_key=`／`Authorization=` 後接值、CWA 金鑰 UUID、`data.moenv.gov.tw/api`、`opendata.cwa.gov.tw/api`）命中 **0**。
- **Codex 獨立實測**（不同 Origin `https://example.org`）：W-C0033-001／O-A0003-001／M-A0085-001 皆 HTTP 200、`ACAO: *`，大小 3391／669342／2902926 bytes，與 DECISIONS 一致；MOENV 無金鑰回 HTTP 200 但內文為「api_key 不存在。」；線上首頁與 `data/index.json` 皆 200。（Codex 因環境無法建暫存目錄，fresh clone 與掃描改由主 session 執行，即上兩項。）

### 未完成／已知限制
- CI 與排程收集待使用者 #1；AQI 新鮮度目標待使用者 #3（DECISIONS D2）。
- 資料年齡 p95 目前是依官方發布落差推估，尚未連續量測（第 2 階段 `/status` 累積）。
- 快照不新時瀏覽器會讀 669 KB／2.9 MB 的官方檔（DECISIONS D7），第 2 階段處理。

### 下一步（階段 2）
- 鄉鎮級 368 選擇（熱傷害資料已是鄉鎮全量）、降雨（鄉鎮預報 F-D0047-0xx）、`/status` 頁、LINE 分享、手機版效能量測。
