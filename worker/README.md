# run-app-api

社群後端尚未部署。前端在 `https://run-app-api.helloajchu.workers.dev/health` 沒有回應時，使用這台裝置的示範模式。

教練 Worker 維持獨立：`https://run-app-coach.helloajchu.workers.dev`。不要把社群表建進教練那個 Worker。

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

## Garmin Connect（OAuth 1.0a）

權杖只存在 D1 的 `garmin_oauth`。Consumer Secret 與 access token 不會進到瀏覽器。

在 Garmin 開發者入口登錄的 Redirect URI 必須一字不差：

`https://helloajchu-png.github.io/run-app/`

部署這個 Worker 之後，在 `worker/` 目錄設定密鑰（終端機會問值，不要寫進檔案）：

```bash
npx wrangler secret put GARMIN_CONSUMER_KEY
npx wrangler secret put GARMIN_CONSUMER_SECRET
```

密鑰還沒設時，`POST /garmin/start` 回 503，訊息是「尚未設定 GARMIN_CONSUMER_KEY / GARMIN_CONSUMER_SECRET」。App 只顯示這句，不會當掉。

端點（基底 `https://run-app-api.helloajchu.workers.dev`）：

- `POST /garmin/start` `{sid}` → `{authorizeUrl}`
- `POST /garmin/complete` `{sid, oauth_token, oauth_verifier}` → `{connected:true}`
- `POST /garmin/status` `{sid}` → `{connected}`
- `POST /garmin/sync` `{sid}` → `{runs}`（最近 14 天內上傳的跑步）
- `POST /garmin/disconnect` `{sid}`

瀏覽器只保存 `sid`（`localStorage` 的 `ra_garmin_sid`）。同步下來的活動寫進跟手動紀錄同一份本機紀錄。
