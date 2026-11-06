'use strict';
const GARMIN_API = 'https://run-app-api.helloajchu.workers.dev';
const SID_KEY = 'ra_garmin_sid';

function gid(s) { return document.getElementById(s); }
function sid() {
  let id = localStorage.getItem(SID_KEY);
  if (!id) { id = crypto.randomUUID().replace(/-/g, ''); localStorage.setItem(SID_KEY, id); }
  return id;
}
function setGarminUi(connected) {
  gid('garminState').textContent = connected ? '已連結。活動只存這台裝置的跑步紀錄。' : '尚未連結';
  gid('garminLink').hidden = connected;
  gid('garminSync').hidden = !connected;
  gid('garminUnlink').hidden = !connected;
}
async function garminPost(path, body) {
  let res;
  try {
    res = await fetch(GARMIN_API + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw new Error('Garmin 伺服器尚未上線或無法連線。請先部署 run-app-api。');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
  return data;
}
async function refreshGarmin() {
  const id = localStorage.getItem(SID_KEY);
  if (!id) { setGarminUi(false); return; }
  try {
    const data = await garminPost('/garmin/status', { sid: id });
    setGarminUi(!!data.connected);
  } catch (err) {
    setGarminUi(false);
    gid('garminMsg').textContent = err.message;
  }
}
async function finishGarminReturn() {
  const q = new URLSearchParams(location.search);
  const token = q.get('oauth_token');
  const verifier = q.get('oauth_verifier');
  if (!token && !verifier) return;
  history.replaceState({}, '', location.pathname);
  if (!token || !verifier) { gid('garminMsg').textContent = 'Garmin 沒有完成授權'; return; }
  try {
    await garminPost('/garmin/complete', { sid: sid(), oauth_token: token, oauth_verifier: verifier });
    setGarminUi(true);
    gid('garminMsg').textContent = '已連結 Garmin';
  } catch (err) {
    setGarminUi(false);
    gid('garminMsg').textContent = err.message;
  }
}

gid('garminLink').addEventListener('click', async () => {
  gid('garminMsg').textContent = '前往 Garmin…';
  try {
    const data = await garminPost('/garmin/start', { sid: sid() });
    if (!data.authorizeUrl) throw new Error('沒有授權網址');
    location.href = data.authorizeUrl;
  } catch (err) {
    gid('garminMsg').textContent = err.message;
  }
});
gid('garminSync').addEventListener('click', async () => {
  const btn = gid('garminSync');
  btn.disabled = true;
  gid('garminMsg').textContent = '同步中…';
  try {
    const data = await garminPost('/garmin/sync', { sid: sid() });
    const merged = window.importGarminRuns(data.runs || []);
    gid('garminMsg').textContent = `匯入 ${merged.added} 筆，略過重複 ${merged.skipped} 筆`;
  } catch (err) {
    gid('garminMsg').textContent = err.message;
  } finally {
    btn.disabled = false;
  }
});
gid('garminUnlink').addEventListener('click', async () => {
  const id = localStorage.getItem(SID_KEY);
  try { if (id) await garminPost('/garmin/disconnect', { sid: id }); } catch (err) { gid('garminMsg').textContent = err.message; }
  localStorage.removeItem(SID_KEY);
  setGarminUi(false);
  gid('garminMsg').textContent = '已解除連結';
});
finishGarminReturn().then(refreshGarmin);
