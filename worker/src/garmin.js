// Garmin Connect Developer Program — OAuth 2.0 PKCE.
// Endpoints below are copied from Garmin's OAuth2.0 PKCE Specification PDF
// (developerportal.garmin.com/sites/default/files/OAuth2PKCE.pdf).
// Starter access is push-only and does not include historical data
// (developer.garmin.com/gc-developer-program). This file does not call a
// history download. Push payload fields are not in that public PDF, so no
// push parser is implemented here.
//
// Secrets, set with wrangler and never committed:
//   GARMIN_CONSUMER_KEY    (OAuth client_id)
//   GARMIN_CONSUMER_SECRET (OAuth client_secret)

export const CALLBACK = 'https://helloajchu-png.github.io/run-app/';
const AUTHORIZE_URL = 'https://connect.garmin.com/oauth2Confirm';
const TOKEN_URL = 'https://connectapi.garmin.com/di-oauth2-service/oauth/token';
const USER_ID_URL = 'https://apis.garmin.com/wellness-api/rest/user/id';
const DEREGISTER_URL = 'https://apis.garmin.com/wellness-api/rest/user/registration';

function fail(message, status) {
  const err = new Error(message);
  err.status = status;
  throw err;
}

function secrets(env) {
  const key = env.GARMIN_CONSUMER_KEY;
  const secret = env.GARMIN_CONSUMER_SECRET;
  if (!key || !secret) fail('尚未設定 GARMIN_CONSUMER_KEY / GARMIN_CONSUMER_SECRET', 503);
  return { key, secret };
}

function database(env) {
  if (!env.DB) fail('D1 尚未綁定。請建立 run-app 資料庫並執行 schema.sql', 503);
  return env.DB;
}

function enc(value) {
  return encodeURIComponent(String(value));
}

function b64url(bytes) {
  let bin = '';
  bytes.forEach(b => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function pkce() {
  const raw = new Uint8Array(32);
  crypto.getRandomValues(raw);
  const verifier = b64url(raw);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: b64url(new Uint8Array(digest)) };
}

function sidOf(body) {
  const sid = String(body.sid || '').trim();
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(sid)) fail('缺少工作階段編號', 400);
  return sid;
}

async function tokenRequest(env, fields) {
  const { key, secret } = secrets(env);
  const form = new URLSearchParams({ client_id: key, client_secret: secret, ...fields });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form,
  });
  const text = await res.text();
  let data = {};
  try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 180) }; }
  if (!res.ok || !data.access_token) fail(`Garmin 權杖交換失敗（${res.status}）${text ? '：' + text.slice(0, 180) : ''}`, 502);
  return data;
}

async function saveTokens(env, sid, data) {
  const expiresAt = new Date(Date.now() + Math.max(0, (Number(data.expires_in) || 0) - 600) * 1000).toISOString();
  await database(env).prepare('UPDATE garmin_oauth SET access_token=?, refresh_token=?, expires_at=?, code_verifier=NULL, updated_at=? WHERE sid=?')
    .bind(data.access_token, data.refresh_token || null, expiresAt, new Date().toISOString(), sid).run();
}

async function bearer(env, row) {
  const fresh = row.expires_at && Date.parse(row.expires_at) > Date.now();
  if (fresh) return row.access_token;
  if (!row.refresh_token) fail('Garmin 授權已過期，請重新連結', 401);
  const data = await tokenRequest(env, { grant_type: 'refresh_token', refresh_token: row.refresh_token });
  await saveTokens(env, row.sid, data);
  return data.access_token;
}

export async function handleGarmin(request, env, url) {
  const db = database(env);
  const body = request.method === 'GET' ? {} : await request.json().catch(() => ({}));

  if (url.pathname === '/garmin/start' && request.method === 'POST') {
    const { key } = secrets(env);
    const sid = sidOf(body);
    const { verifier, challenge } = await pkce();
    const state = b64url(crypto.getRandomValues(new Uint8Array(24)));
    await db.prepare(`INSERT INTO garmin_oauth (sid, state, code_verifier, access_token, refresh_token, expires_at, garmin_user_id, updated_at)
      VALUES (?, ?, ?, NULL, NULL, NULL, NULL, ?)
      ON CONFLICT(sid) DO UPDATE SET state=excluded.state, code_verifier=excluded.code_verifier, access_token=NULL, refresh_token=NULL, expires_at=NULL, updated_at=excluded.updated_at`)
      .bind(sid, state, verifier, new Date().toISOString()).run();
    const authorizeUrl = `${AUTHORIZE_URL}?response_type=code&client_id=${enc(key)}&code_challenge=${enc(challenge)}&code_challenge_method=S256&redirect_uri=${enc(CALLBACK)}&state=${enc(state)}`;
    return { authorizeUrl };
  }

  if (url.pathname === '/garmin/complete' && request.method === 'POST') {
    secrets(env);
    const sid = sidOf(body);
    const code = String(body.code || '');
    const state = String(body.state || '');
    if (!code || !state) fail('Garmin 沒有完成授權', 400);
    const row = await db.prepare('SELECT sid, state, code_verifier FROM garmin_oauth WHERE sid=?').bind(sid).first();
    if (!row || !row.code_verifier || row.state !== state) fail('找不到這次連結工作階段，請再按一次連結 Garmin', 400);
    const data = await tokenRequest(env, {
      grant_type: 'authorization_code',
      code,
      code_verifier: row.code_verifier,
      redirect_uri: CALLBACK,
    });
    await saveTokens(env, sid, data);
    let garminUserId = null;
    const who = await fetch(USER_ID_URL, { headers: { Authorization: `Bearer ${data.access_token}` } });
    if (who.ok) {
      const info = await who.json().catch(() => ({}));
      garminUserId = info.userId || null;
      if (garminUserId) await db.prepare('UPDATE garmin_oauth SET garmin_user_id=? WHERE sid=?').bind(garminUserId, sid).run();
    }
    return { connected: true, garminUserId };
  }

  if (url.pathname === '/garmin/status' && request.method === 'POST') {
    const sid = sidOf(body);
    const row = await db.prepare('SELECT access_token FROM garmin_oauth WHERE sid=?').bind(sid).first();
    return { connected: !!(row && row.access_token) };
  }

  if (url.pathname === '/garmin/disconnect' && request.method === 'POST') {
    const sid = sidOf(body);
    const row = await db.prepare('SELECT * FROM garmin_oauth WHERE sid=?').bind(sid).first();
    if (row && row.access_token) {
      try {
        const token = await bearer(env, row);
        await fetch(DEREGISTER_URL, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
      } catch { /* still drop the local row */ }
    }
    await db.prepare('DELETE FROM garmin_oauth WHERE sid=?').bind(sid).run();
    return { connected: false };
  }

  if (url.pathname === '/garmin/sync' && request.method === 'POST') {
    fail('Starter 方案沒有歷史活動可下載。公開說明是 Push only，而且不含 Historical Data。推送內容的欄位只在登入後的 API Tools，這裡不接收未公開的格式。', 501);
  }

  fail('找不到', 404);
}
