# 跑步教練

靜態 PWA：記錄跑步、匯入 Garmin 活動（CSV／GPX／FIT）、估算體能並產生課表。要先用電子郵件登入。紀錄存在帳號裡，這台瀏覽器也留一份，換手機登入同一個帳號可以接上。

線上 App：https://run-together.pages.dev/

https://helloajchu-png.github.io/run-app/ 只做轉址。它會清掉舊的 service worker 與快取，再用 URL fragment（不是 query）把 `ra_garmin_sid` 和其他本機紀錄帶到新網站。Garmin 回到舊網址時帶的 `?code=&state=` 也只放進 fragment，新網站登入後完成授權。

App 在 `site/`。更新 Pages 時：

```bash
npx wrangler pages deploy site --project-name run-together
```
