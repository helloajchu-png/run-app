# 跑步教練

靜態 PWA：記錄跑步、匯入 Garmin 活動（CSV／GPX／FIT）、估算體能並產生課表。要先用電子郵件登入。紀錄存在帳號裡，這台瀏覽器也留一份，換手機登入同一個帳號可以接上。

線上開啟：https://run-together.pages.dev/（換址期間舊網址 https://helloajchu-png.github.io/run-app/ 仍是同一個 App）。路徑都是相對的，所以網站放在網域根目錄或 `/run-app/` 都能用。

可將網站加到主畫面。這台裝置會保持登入，離線時仍看得到已同步的紀錄。

靜態檔部署到 Cloudflare Pages（不要部署整個 repo，裡面有 Worker 原始碼）：

```bash
bash scripts/stage-pages.sh
npx wrangler pages deploy dist --project-name run-together
```

若 `run-together` 這個專案名稱已被使用，改用 `run-together-app`。API 已同時允許這兩個 Pages 網址。GitHub Pages 改成轉址的那個分支先不要合併。
