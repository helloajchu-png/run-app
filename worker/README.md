# run-app-api

已部署：https://run-app-api.helloajchu.workers.dev  
`/health` 回 `{"ok":true,"mode":"d1","garmin":true}`。  
D1 `run-app` 的 database_id 是 `00ce5642-5c60-4355-868a-49924791dea9`。

教練 Worker 維持獨立，不要改它：`https://run-app-coach.helloajchu.workers.dev`。

## Aj 在 Cloudflare 要做的事

1. 安裝並登入 Wrangler（需有 `helloajchu` 帳號權限）。
2. 在 repo 的 `worker/` 目錄：

```bash
npx wrangler d1 create run-app
```

把印出的 `database_id` 寫進 `worker/wrangler.toml` 的 `database_id`。

3. 建立資料表：

```bash
npx wrangler d1 execute run-app --remote --file=schema.sql
```

4. 部署：

```bash
npx wrangler deploy
```

確認 `https://run-app-api.helloajchu.workers.dev/health` 回 `{"ok":true,"mode":"d1"}`。

## 行為

- 暱稱 + 4 位數 PIN。PIN 以 PBKDF2 雜湊存在 D1，不存原文。
- `visibility` 固定 `friends`。動態只給自己與雙向好友。
- `POST /friends` 用暱稱互相加為好友。
- `POST /posts` 的 `kind` 為 `run` 或 `week`。
- `POST /posts/:id/like` 再按一次取消。
- CORS 只允許 `https://helloajchu-png.github.io`。

## Garmin Connect（OAuth 2.0 PKCE）

公開規格：Garmin 的 OAuth2.0 PKCE Specification（`developerportal.garmin.com/sites/default/files/OAuth2PKCE.pdf`）。

- 授權：`GET https://connect.garmin.com/oauth2Confirm`
- 權杖：`POST https://connectapi.garmin.com/di-oauth2-service/oauth/token`
- 使用者 ID：`GET https://apis.garmin.com/wellness-api/rest/user/id`
- 解除登記：`DELETE https://apis.garmin.com/wellness-api/rest/user/registration`

Starter 是 Push only，不含歷史資料（`developer.garmin.com/gc-developer-program`）。`POST /garmin/sync` 與 `POST /garmin/inbox` 只讀已經推進 D1 的活動，不會向 Garmin 拉歷史。

在 Garmin 表單的 OAuth redirect URL 必須一字不差（含結尾斜線）：

`https://helloajchu-png.github.io/run-app/`

App 建立並部署這個 Worker 之後，在 `worker/` 設定密鑰（不要寫進檔案）：

```bash
npx wrangler secret put GARMIN_CONSUMER_KEY
npx wrangler secret put GARMIN_CONSUMER_SECRET
```

`GARMIN_CONSUMER_KEY` 是 OAuth client_id，`GARMIN_CONSUMER_SECRET` 是 client_secret。尚未建立 App 之前沒有這兩組值。密鑰未設定時，`POST /garmin/start` 回 503。

這個 Worker 已部署。密鑰 `GARMIN_CONSUMER_KEY` 與 `GARMIN_CONSUMER_SECRET` 已在 Cloudflare 設定，不在 repo。

活動還不會自動進來，直到 Aj 在 Garmin API Tools 把 Push 網址設成：

`https://run-app-api.helloajchu.workers.dev/garmin/push`

資料類型選 Activity 的活動摘要（Activities），傳送方式選 Push，不要選 Ping，也不要開歷史 backfill。公開的 Activity API 頁只寫 Push only、不含 Historical Data，沒有列出 JSON 欄位；接收端只使用 OAuth 規格寫明的 `userId`，其餘欄位有出現才讀。`callbackURL` 這種 ping 只回 200，不會再去拉資料。

已連結的 App 會呼叫 `POST /garmin/inbox`，把 D1 裡新存的跑步併進本機紀錄（以日期加距離去重）。

若 `garmin_activities` 還沒建，在 `worker/` 執行：

```bash
npx wrangler d1 execute run-app --remote --file=migrations/001_garmin_activities.sql
```
