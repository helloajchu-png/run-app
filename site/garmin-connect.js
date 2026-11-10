'use strict';
const SID_KEY = 'ra_garmin_sid';
const CONSENT_KEY = 'ra_garmin_coach_ok';

function gid(s) { return document.getElementById(s); }
function setGarminUi(connected) {
  gid('garminState').textContent = connected
    ? '已連結這個帳號。換手機登入後也會顯示已連結，不用重新授權。連結前的舊活動不會補進。'
    : '尚未連結。連結一次就存在這個帳號，其他裝置登入後也會是已連結。';
  gid('garminLink').hidden = connected;
  gid('garminUnlink').hidden = !connected;
}
async function garminPost(path, body) {
  if (!window.RA_AUTH || !window.RA_AUTH.token()) throw new Error('請先登入');
  return window.RA_AUTH.api(path, { method: 'POST', body: body || {} });
}
async function pullInbox() {
  if (!window.importGarminRuns) return;
  const data = await garminPost('/garmin/inbox', {});
  const merged = window.importGarminRuns(data.runs || []);
  if (merged.added) gid('garminMsg').textContent = `新活動 ${merged.added} 筆已加入紀錄`;
}
async function refreshGarmin() {
  if (!window.RA_AUTH || !window.RA_AUTH.token()) { setGarminUi(false); return; }
  try {
    const data = await garminPost('/garmin/status', {});
    setGarminUi(!!data.connected);
    if (data.connected) await pullInbox();
  } catch (err) {
    setGarminUi(false);
    gid('garminMsg').textContent = err.message;
  }
}
function oauthReturn() {
  const params = new URLSearchParams(location.search);
  const queryCode = params.get('code');
  const queryState = params.get('state');
  if (queryCode || queryState) return { code: queryCode, state: queryState, fromQuery: true };
  try {
    const saved = JSON.parse(sessionStorage.getItem('ra_oauth_return') || 'null');
    if (saved && saved.code && saved.state) return { code: saved.code, state: saved.state, fromQuery: false };
  } catch { /* ignore a bad handoff */ }
  return null;
}
async function finishGarminReturn() {
  const found = oauthReturn();
  if (!found) return;
  if (found.fromQuery) history.replaceState({}, '', location.pathname);
  sessionStorage.removeItem('ra_oauth_return');
  const code = found.code;
  const state = found.state;
  if (!code || !state) { gid('garminMsg').textContent = 'Garmin 沒有完成授權'; return; }
  try {
    await garminPost('/garmin/complete', { code, state });
    setGarminUi(true);
    gid('garminMsg').textContent = '已連結這個帳號。之後的新跑步會進來，其他裝置登入後也看得到連結。';
  } catch (err) {
    gid('garminMsg').textContent = err.message;
  }
}
async function claimOldDevice() {
  const old = localStorage.getItem(SID_KEY);
  if (!old) return;
  try {
    await garminPost('/garmin/claim', { sid: old });
    localStorage.removeItem(SID_KEY);
  } catch (err) {
    if (err.status === 409) localStorage.removeItem(SID_KEY);
  }
}
async function garminBoot() {
  await claimOldDevice();
  await finishGarminReturn();
  await refreshGarmin();
}

gid('garminCoachOk').checked = localStorage.getItem(CONSENT_KEY) === '1';
gid('garminCoachOk').addEventListener('change', () => {
  if (gid('garminCoachOk').checked) localStorage.setItem(CONSENT_KEY, '1');
  else localStorage.removeItem(CONSENT_KEY);
  gid('garminMsg').textContent = gid('garminCoachOk').checked
    ? '之後問教練時才會附上來源為 Garmin 的紀錄。可隨時取消。這項同意只在這台裝置。'
    : '已停止把 Garmin 紀錄放進之後的教練問答。';
});
gid('garminLink').addEventListener('click', async () => {
  gid('garminMsg').textContent = '前往 Garmin…';
  try {
    const data = await garminPost('/garmin/start', {});
    if (!data.authorizeUrl) throw new Error('沒有授權網址');
    location.href = data.authorizeUrl;
  } catch (err) {
    gid('garminMsg').textContent = err.message;
  }
});
gid('garminUnlink').addEventListener('click', async () => {
  try { await garminPost('/garmin/disconnect', {}); setGarminUi(false); gid('garminMsg').textContent = '已解除這個帳號的 Garmin 連結。'; }
  catch (err) { gid('garminMsg').textContent = err.message; }
});
window.addEventListener('ra-ready', garminBoot);
