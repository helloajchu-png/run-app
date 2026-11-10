# run-app-api

已部署：https://run-app-api.helloajchu.workers.dev  
`/health` 回 `{"ok":true,"mode":"d1","garmin":true,"auth":true}`。  
D1 `run-app` 的 database_id 是 `00ce5642-5c60-4355-868a-49924791dea9`。

教練 Worker 維持獨立，不要改它：`https://run-app-coach.helloajchu.workers.dev`。

## 部署

換到 Cloudflare Pages 這次不要改 D1，不要執行 `wrangler d1 migrations apply`。

在 `worker/` 只更新程式（保留已設定的變數與密鑰）：

```bash
npx wrangler deploy --keep-vars
```

`--keep-vars` 會留下已經在 Cloudflare 上的變數和密鑰。部署後確認 `/health` 的 `auth` 是 `true`。這次沒有資料表變更。

本機測試（Node 22，不用安裝套件）：

```bash
npm test
```

## 密鑰與變數

沒有新的密鑰。密碼雜湊在 Worker 裡用 WebCrypto 計算，不需要 pepper。

已經設定、不要寫進檔案的密鑰：

```bash
npx wrangler secret put GARMIN_CONSUMER_KEY
npx wrangler secret put GARMIN_CONSUMER_SECRET
```

`GARMIN_CONSUMER_KEY` 是 OAuth client_id，`GARMIN_CONSUMER_SECRET` 是 client_secret。未設定時，`POST /garmin/start` 回 503。

CORS 預設同時允許：

- `https://helloajchu-png.github.io`
- `https://run-together.pages.dev`
- `https://run-together-app.pages.dev`（專案名稱被占用時的備援）

選用變數（不是密鑰）：`ALLOWED_ORIGIN`。設了會加進上面的清單，不會拿掉預設來源。不要把密鑰放進 `wrangler.toml`。

## 帳號行為

- `POST /auth/register`、`POST /auth/login`：電子郵件會轉成小寫。密碼以 PBKDF2-SHA256、100,000 次、每人 16 byte 鹽值雜湊，不存原文。
- 登入與註冊依 IP 限流（登入 15 分鐘 10 次，註冊 1 小時 5 次）。
- 工作階段權杖是隨機值，D1 只存 SHA-256。大約 400 天到期。`POST /auth/logout` 刪掉這一個。`POST /auth/change-password` 刪掉其他裝置的工作階段。
- `POST /auth/delete-account` 要目前密碼。會刪掉該帳號的紀錄、設定、動態、工作階段，以及這個帳號的 Garmin 權杖。
- `GET /sync`、`PUT /sync` 只碰到登入者自己的跑步、比賽、目標、課表勾選、教練網址與下週計畫。跑步以 client id 更新；同一天、距離四捨五入到 0.05 公里視作同一筆。`mode:"merge"` 只補上還沒有的紀錄，不刪舊的。
- `GET /me`、`PUT /me`：顯示名稱，以及 `isPublic`（預設關閉）。
- `GET /feed`：未公開的人拿不到別人的動態、週跑量或配速。公開的人只看得到其他 `is_public` 的帳號。關掉公開後，下一次讀取就看不到。

舊的暱稱加 PIN 資料表（`users`、`sessions`、`friends`、`posts`、`likes`）留著，這支 API 不再用它們登入。

## Garmin Connect（OAuth 2.0 PKCE）

公開規格：Garmin 的 OAuth2.0 PKCE Specification（`developerportal.garmin.com/sites/default/files/OAuth2PKCE.pdf`）。

- 授權：`GET https://connect.garmin.com/oauth2Confirm`
- 權杖：`POST https://connectapi.garmin.com/di-oauth2-service/oauth/token`
- 使用者 ID：`GET https://apis.garmin.com/wellness-api/rest/user/id`
- 解除登記：`DELETE https://apis.garmin.com/wellness-api/rest/user/registration`

權杖和 Garmin user id 寫在 `garmin_oauth.user_id`，跟著帳號走。另一台裝置登入同一個帳號後，`POST /garmin/status` 就是已連結，`POST /garmin/inbox` 讀得到已推進來的跑步。推送網址不要改，Garmin 已經登記：

`https://run-app-api.helloajchu.workers.dev/garmin/push`

OAuth redirect URI 也不要改，Garmin 登記的是（含結尾斜線）：

`https://helloajchu-png.github.io/run-app/`

授權完成後，Garmin 仍把瀏覽器送回這個舊網址，並在 query 帶 `code` 與 `state`。換址用的 GitHub Pages 轉址頁會把這兩個值放進新網站的 fragment，新網站再呼叫 `/garmin/complete`。權杖交換送出的 `redirect_uri` 維持上面這個舊網址，所以 Garmin 開發者後台不用改。若以後要讓 Garmin 直接導回 Pages，必須先在後台新增完全一樣的 `https://run-together.pages.dev/`，才能改程式裡的 `CALLBACK`。

`POST /garmin/push` 不需登入。只留下跑步；有對到帳號時，同時寫進該帳號的 `user_runs`。Starter 是 Push only，不含歷史資料。`callbackURL` 這種 ping 只略過，不會再去拉資料。

在 Garmin 表單的 OAuth redirect URL 必須一字不差（含結尾斜線）：

`https://helloajchu-png.github.io/run-app/`

以前用瀏覽器 `sid` 連過、還沒綁帳號的列，可以在登入後由 `POST /garmin/claim` 認領一次。已經屬於別的帳號的列不能被抢走。
