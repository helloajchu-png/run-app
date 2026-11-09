'use strict';
const GARMIN_API = 'https://run-app-api.helloajchu.workers.dev';
const SID_KEY = 'ra_garmin_sid';
const CONSENT_KEY = 'ra_garmin_coach_ok';

function gid(s) { return document.getElementById(s); }
function sid() {
  let id = localStorage.getItem(SID_KEY);
  if (!id) { id = crypto.randomUUID().replace(/-/g, ''); localStorage.setItem(SID_KEY, id); }
  return id;
}
function setGarminUi(connected) {
  gid('garminState').textContent = connected
    ? '已連結。Starter 不會匯入連結前的舊活動。'
    : '尚未連結。按下去只會開始授權；伺服器未部署時不會連上 Garmin。';
  gid('garminLink').hidden = connected;
  gid('garminUnlink').hidden = !connected;
}
async function garminPost(path, body) {
  let res;
  try {
    res = await fetch(GARMIN_API + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw new Error('Garmin 伺服器尚未部署或無法連線。這不會影響手動紀錄。');
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
  const code = q.get('code');
  const state = q.get('state');
  if (!code && !state) return;
  history.replaceState({}, '', location.pathname);
  if (!code || !state) { gid('garminMsg').textContent = 'Garmin 沒有完成授權'; return; }
  try {
    await garminPost('/garmin/complete', { sid: sid(), code, state });
    setGarminUi(true);
    gid('garminMsg').textContent = '已連結。之後的新活動要等推送接收端上線才會進來，不會補舊紀錄。';
  } catch (err) {
    setGarminUi(false);
    gid('garminMsg').textContent = err.message;
  }
}

gid('garminCoachOk').checked = localStorage.getItem(CONSENT_KEY) === '1';
gid('garminCoachOk').addEventListener('change', () => {
  if (gid('garminCoachOk').checked) localStorage.setItem(CONSENT_KEY, '1');
  else localStorage.removeItem(CONSENT_KEY);
  gid('garminMsg').textContent = gid('garminCoachOk').checked
    ? '之後問教練時才會附上來源為 Garmin 的紀錄。可隨時取消。'
    : '已停止把 Garmin 紀錄放進之後的教練問答。';
});
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
gid('garminUnlink').addEventListener('click', async () => {
  const id = localStorage.getItem(SID_KEY);
  try { if (id) await garminPost('/garmin/disconnect', { sid: id }); }
  catch (err) { gid('garminMsg').textContent = err.message; }
  localStorage.removeItem(SID_KEY);
  setGarminUi(false);
  if (!gid('garminMsg').textContent) gid('garminMsg').textContent = '已解除這台裝置上的連結編號。';
});
finishGarminReturn().then(refreshGarmin);
