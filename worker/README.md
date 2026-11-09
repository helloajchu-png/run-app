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

## Garmin Connect（OAuth 2.0 PKCE）

公開規格：Garmin 的 OAuth2.0 PKCE Specification（`developerportal.garmin.com/sites/default/files/OAuth2PKCE.pdf`）。

- 授權：`GET https://connect.garmin.com/oauth2Confirm`
- 權杖：`POST https://connectapi.garmin.com/di-oauth2-service/oauth/token`
- 使用者 ID：`GET https://apis.garmin.com/wellness-api/rest/user/id`
- 解除登記：`DELETE https://apis.garmin.com/wellness-api/rest/user/registration`

Starter 是 Push only，不含歷史資料（`developer.garmin.com/gc-developer-program`）。這個 Worker 不做歷史下載。`POST /garmin/sync` 回 501。推送本文格式不在上述公開 PDF，因此沒有推送解析。

在 Garmin 表單的 OAuth redirect URL 必須一字不差（含結尾斜線）：

`https://helloajchu-png.github.io/run-app/`

App 建立並部署這個 Worker 之後，在 `worker/` 設定密鑰（不要寫進檔案）：

```bash
npx wrangler secret put GARMIN_CONSUMER_KEY
npx wrangler secret put GARMIN_CONSUMER_SECRET
```

`GARMIN_CONSUMER_KEY` 是 OAuth client_id，`GARMIN_CONSUMER_SECRET` 是 client_secret。尚未建立 App 之前沒有這兩組值。密鑰未設定時，`POST /garmin/start` 回 503。

這個 Worker 目前還沒有部署到 `https://run-app-api.helloajchu.workers.dev`。
