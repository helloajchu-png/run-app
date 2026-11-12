'use strict';
const TOKEN_KEY = 'ra_token';
const PROFILE_KEY = 'ra_profile';
const BOUND_KEY = 'ra_bound_user';
const PENDING_KEY = 'ra_pending_import';
const DELETE_KEY = 'ra_pending_deletes';

function apiBase() {
  return String(window.RA_API || 'https://run-app-api.helloajchu.workers.dev').replace(/\/$/, '');
}
function authEl(id) { return document.getElementById(id); }
function loadJson(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function loadDeletes() { return loadJson(DELETE_KEY, []); }
function saveDeletes(ids) { localStorage.setItem(DELETE_KEY, JSON.stringify([...new Set(ids.filter(Boolean))])); }
function pendingImport() {
  const value = loadJson(PENDING_KEY, null);
  return value && Array.isArray(value.runs) ? value : null;
}
function asRun(run) {
  return {
    id: String(run.id),
    date: run.date,
    distanceKm: Number(run.distanceKm),
    durationSec: Number(run.durationSec),
    avgHr: run.avgHr == null ? null : Number(run.avgHr),
    note: run.note || '',
    source: run.source || 'manual',
  };
}

let current = null;
let signingUp = false;
let flushing = false;
let flushAgain = false;
let syncTimer = null;

function setText(id, text) {
  const el = authEl(id);
  if (el) el.textContent = text || '';
}
function setAuthMsg(text) { setText('authMsg', text); }
function setSyncStatus(text) { setText('syncState', text); }
function setProfileMsg(text) { setText('profileMsg', text); }
function setImportMsg(text) { setText('importMsg', text); }

async function api(path, opt = {}) {
  const headers = { ...(opt.headers || {}) };
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) headers.Authorization = 'Bearer ' + token;
  let body = opt.body;
  if (body !== undefined && typeof body !== 'string') {
    body = JSON.stringify(body);
    headers['Content-Type'] = 'application/json';
  }
  let res;
  try { res = await fetch(apiBase() + path, { method: opt.method || 'GET', headers, body }); }
  catch { const err = new Error('連不上帳號伺服器'); err.status = 0; throw err; }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || ('HTTP ' + res.status));
    err.status = res.status;
    throw err;
  }
  return data;
}

function paintIdentity() {
  const who = authEl('whoami');
  if (who) who.textContent = current ? (current.displayName || '跑者') + ' · 已登入' : '';
  const email = authEl('accountEmail');
  if (email) email.textContent = current ? current.email : '';
  const name = authEl('displayName');
  if (name && current && document.activeElement !== name) name.value = current.displayName || '';
  const toggle = authEl('publicToggle');
  if (toggle && current && document.activeElement !== toggle) toggle.checked = !!current.isPublic;
  const socialName = authEl('socialName');
  if (socialName && current) socialName.textContent = current.displayName || '我';
}

function rememberPhoneRuns() {
  if (localStorage.getItem(BOUND_KEY) || localStorage.getItem(PENDING_KEY) || !window.RA) return;
  const snap = window.RA.snapshotLocal();
  if (!snap.runs || !snap.runs.length) return;
  localStorage.setItem(PENDING_KEY, JSON.stringify(snap));
}

function refreshImportUi() {
  const pending = pendingImport();
  const has = !!(pending && pending.runs.length);
  const banner = authEl('importBanner');
  const again = authEl('importAgain');
  const hidden = sessionStorage.getItem('ra_import_hide') === '1';
  if (banner) banner.hidden = !has || hidden;
  if (again) again.hidden = !has;
  const count = authEl('importCount');
  if (count) count.textContent = has ? `這台手機上有 ${pending.runs.length} 筆還沒放進帳號的跑步。匯入成功之前，不會刪掉它們。` : '';
}

async function flushSync() {
  if (!localStorage.getItem(TOKEN_KEY) || !window.RA) return;
  if (flushing) { flushAgain = true; return; }
  flushing = true;
  try {
    let res = null;
    do {
      flushAgain = false;
      const deletedIds = loadDeletes();
      const clearCrossTraining = localStorage.getItem('ra_clear_cross') === '1';
      res = await api('/sync', {
        method: 'PUT',
        body: { runs: window.RA.runs.slice(), deletedIds, settings: window.RA.readSettings(), goalProfile: window.RA.goalProfile ? window.RA.goalProfile() : null, clearCrossTraining },
      });
      if (clearCrossTraining) localStorage.removeItem('ra_clear_cross');
      const sent = new Set(deletedIds);
      saveDeletes(loadDeletes().filter(id => !sent.has(id)));
    } while (flushAgain);
    const pendingDeletes = new Set(loadDeletes());
    window.RA.setRuns((res.runs || []).map(asRun).filter(run => !pendingDeletes.has(run.id)));
    if (window.RA.setCross) window.RA.setCross(res.crossTraining || []);
    window.RA.applySettings(res.settings || {});
    if (res.goalProfile && window.RA.applyGoalProfile) window.RA.applyGoalProfile(res.goalProfile, { keepOpen: document.body.classList.contains('picking') });
    setSyncStatus('');
  } catch {
    setSyncStatus('還沒同步到帳號，紀錄仍留在這台手機。');
  } finally {
    flushing = false;
    if (flushAgain) scheduleAccountSync();
  }
}

function scheduleAccountSync() {
  if (!localStorage.getItem(TOKEN_KEY)) return;
  if (flushing) { flushAgain = true; return; }
  clearTimeout(syncTimer);
  syncTimer = setTimeout(flushSync, 400);
}

function noteAccountDelete(id) {
  if (!id) return;
  saveDeletes(loadDeletes().concat(id));
}

async function syncFromServer() {
  rememberPhoneRuns();
  const data = await api('/sync');
  const deleted = new Set(loadDeletes());
  window.RA.setRuns((data.runs || []).map(asRun).filter(run => !deleted.has(run.id)));
  if (window.RA.setCross) window.RA.setCross(data.crossTraining || []);
  window.RA.applySettings(data.settings || {});
  if (window.RA.applyGoalProfile) window.RA.applyGoalProfile(data.goalProfile || null);
  if (current) localStorage.setItem(BOUND_KEY, current.id);
  refreshImportUi();
  if (loadDeletes().length) await flushSync();
}

async function enterApp(user) {
  current = user;
  localStorage.setItem(PROFILE_KEY, JSON.stringify(user));
  document.body.classList.remove('locked');
  paintIdentity();
  try { await syncFromServer(); }
  catch { setSyncStatus('帳號資料還沒同步，這台手機上的紀錄還在。'); refreshImportUi(); }
  window.dispatchEvent(new CustomEvent('ra-ready'));
}

function localSignOut(message) {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(PROFILE_KEY);
  localStorage.removeItem(BOUND_KEY);
  current = null;
  if (window.RA) window.RA.clearLocal();
  sessionStorage.removeItem('ra_import_hide');
  document.body.classList.add('locked');
  paintIdentity();
  setAuthMsg(message || '');
  const form = authEl('authForm');
  if (form) form.reset();
  window.dispatchEvent(new Event('ra-locked'));
}

function showAuthMode() {
  const nameLabel = authEl('authNameLabel');
  if (nameLabel) nameLabel.hidden = !signingUp;
  const title = authEl('authTitle');
  if (title) title.textContent = signingUp ? '建立帳號' : '登入';
  const lead = authEl('authLead');
  if (lead) lead.textContent = signingUp
    ? '用電子郵件和密碼就好。密碼至少 8 碼。這台裝置會保持登入，紀錄會跟著帳號走。'
    : '跑完的路，換一支手機也還在。登入一次，這台裝置會記得你。';
  const submit = authEl('authSubmit');
  if (submit) submit.textContent = signingUp ? '建立帳號' : '登入';
  const swap = authEl('authSwitch');
  if (swap) swap.textContent = signingUp ? '我已經有帳號' : '建立帳號';
  const password = authEl('authPassword');
  if (password) password.autocomplete = signingUp ? 'new-password' : 'current-password';
}

async function submitAuth(event) {
  event.preventDefault();
  const button = authEl('authSubmit');
  if (button) button.disabled = true;
  setAuthMsg(signingUp ? '建立中…' : '登入中…');
  try {
    const body = { email: authEl('authEmail').value.trim(), password: authEl('authPassword').value };
    if (signingUp) body.displayName = authEl('authName').value.trim();
    const res = await api(signingUp ? '/auth/register' : '/auth/login', { method: 'POST', body });
    localStorage.setItem(TOKEN_KEY, res.token);
    authEl('authPassword').value = '';
    await enterApp(res.user);
    setAuthMsg('');
  } catch (err) {
    setAuthMsg(err.message || '沒有成功');
  } finally {
    if (button) button.disabled = false;
  }
}

async function saveProfile() {
  if (!current) return;
  const displayName = authEl('displayName').value.trim();
  const isPublic = !!authEl('publicToggle').checked;
  try {
    const user = await api('/me', { method: 'PUT', body: { displayName, isPublic } });
    current = user;
    localStorage.setItem(PROFILE_KEY, JSON.stringify(user));
    paintIdentity();
    setProfileMsg(user.isPublic ? '已公開。其他公開的跑者現在看得到你，你也看得到他們。' : '已關閉公開。其他人現在看不到你的動態。');
    window.dispatchEvent(new CustomEvent('ra-profile'));
  } catch (err) {
    if (authEl('publicToggle')) authEl('publicToggle').checked = !!current.isPublic;
    setProfileMsg(err.message || '沒有儲存');
  }
}

async function importPhoneRuns() {
  const pending = pendingImport();
  if (!pending || !pending.runs.length) return;
  setImportMsg('匯入中…');
  try {
    const res = await api('/sync', {
      method: 'PUT',
      body: {
        mode: 'merge',
        runs: pending.runs,
        settings: {
          race: pending.race || null,
          goal: pending.goal || null,
          checks: pending.checks || {},
          planBlurb: pending.planBlurb || '',
        },
      },
    });
    localStorage.removeItem(PENDING_KEY);
    window.RA.setRuns((res.runs || []).map(asRun));
    window.RA.applySettings(res.settings || {});
    sessionStorage.removeItem('ra_import_hide');
    refreshImportUi();
    setImportMsg('已放進這個帳號。');
    setSyncStatus('');
  } catch (err) {
    setImportMsg('還沒匯入成功，手機上的紀錄還留著。' + (err.message || ''));
  }
}

async function boot() {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) {
    document.body.classList.add('locked');
    return;
  }
  try {
    await enterApp(await api('/me'));
  } catch (err) {
    if (err.status === 401) {
      localStorage.removeItem(TOKEN_KEY);
      document.body.classList.add('locked');
      setAuthMsg('登入已過期，請再登入一次');
      return;
    }
    const cached = loadJson(PROFILE_KEY, null);
    if (cached && localStorage.getItem(BOUND_KEY)) {
      current = cached;
      document.body.classList.remove('locked');
      paintIdentity();
      setSyncStatus('目前連不上帳號，先顯示這台手機上的內容。');
      window.dispatchEvent(new CustomEvent('ra-ready'));
      return;
    }
    document.body.classList.add('locked');
    setAuthMsg(err.message || '目前連不上伺服器，請稍後再試');
  }
}

window.RA_AUTH = { token: () => localStorage.getItem(TOKEN_KEY) || '', user: () => current, api, apiBase };
window.scheduleAccountSync = scheduleAccountSync;
window.noteAccountDelete = noteAccountDelete;

const authForm = authEl('authForm');
if (authForm) authForm.addEventListener('submit', submitAuth);
const authSwitch = authEl('authSwitch');
if (authSwitch) authSwitch.addEventListener('click', () => { signingUp = !signingUp; setAuthMsg(''); showAuthMode(); });
const saveProfileBtn = authEl('saveProfile');
if (saveProfileBtn) saveProfileBtn.addEventListener('click', saveProfile);
const publicToggle = authEl('publicToggle');
if (publicToggle) publicToggle.addEventListener('change', saveProfile);
const importLocal = authEl('importLocal');
if (importLocal) importLocal.addEventListener('click', importPhoneRuns);
const importAgain = authEl('importAgain');
if (importAgain) importAgain.addEventListener('click', importPhoneRuns);
const importSkip = authEl('importSkip');
if (importSkip) importSkip.addEventListener('click', () => { sessionStorage.setItem('ra_import_hide', '1'); refreshImportUi(); });
const logoutBtn = authEl('logoutBtn');
if (logoutBtn) logoutBtn.addEventListener('click', async () => {
  try { await flushSync(); } catch { /* leave even if the last sync failed */ }
  try { await api('/auth/logout', { method: 'POST', body: {} }); } catch { /* still leave this device */ }
  localSignOut('已登出。這台裝置上的帳號快取已清掉。');
});
const changePasswordBtn = authEl('changePassword');
if (changePasswordBtn) changePasswordBtn.addEventListener('click', async () => {
  setText('passwordMsg', '更新中…');
  try {
    await api('/auth/change-password', {
      method: 'POST',
      body: { currentPassword: authEl('oldPassword').value, newPassword: authEl('newPassword').value },
    });
    authEl('oldPassword').value = '';
    authEl('newPassword').value = '';
    setText('passwordMsg', '已更新密碼。其他裝置會被登出，這台保持登入。');
  } catch (err) {
    setText('passwordMsg', err.message || '沒有更新');
  }
});
const deleteAccountBtn = authEl('deleteAccount');
if (deleteAccountBtn) deleteAccountBtn.addEventListener('click', async () => {
  if (!confirm('確定永久刪除這個帳號？雲端紀錄和 Garmin 連結會一起刪掉。')) return;
  setText('deleteMsg', '刪除中…');
  try {
    await api('/auth/delete-account', { method: 'POST', body: { password: authEl('deletePassword').value } });
    localSignOut('帳號已刪除。');
  } catch (err) {
    setText('deleteMsg', err.message || '沒有刪除');
  }
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushSync();
});
showAuthMode();
boot();
