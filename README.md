# taiwan-life-data：歷史存檔（`data` 分支）

這個分支只放自動產生的歷史存檔，由收集流程（`npm run archive`）每次收集後 commit。程式碼在 `main` 分支。

- 格式與用法：[docs/API.md「歷史存檔」](https://github.com/livejiaquan/taiwan-life-data/blob/main/docs/API.md#歷史存檔archivev1)
- 目錄：`v1/index.json`；每個 feed 每個台北日一檔：`v1/<feed>/<YYYY-MM-DD>.json`
- 最新版只保留最近 90 天，更舊的檔案在 git 歷史中
- 網站鏡像：`https://livejiaquan.github.io/taiwan-life-data/archive/v1/…`

資料來源為交通部中央氣象署、環境部、台灣電力公司、經濟部水利署開放資料，依政府資料開放授權條款－第1版使用；每個檔案的 `source` 欄位註明原始資料集。
