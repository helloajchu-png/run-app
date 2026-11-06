// Garmin Connect OAuth 1.0a + Activity API.
// Secrets (set with wrangler, never commit): GARMIN_CONSUMER_KEY, GARMIN_CONSUMER_SECRET
// Redirect URI registered in the Garmin portal must be exactly CALLBACK.

export const CALLBACK = 'https://helloajchu-png.github.io/run-app/';
const REQUEST_TOKEN_URL = 'https://connectapi.garmin.com/oauth-service/oauth/request_token';
const AUTHORIZE_URL = 'https://connect.garmin.com/oauthConfirm';
const ACCESS_TOKEN_URL = 'https://connectapi.garmin.com/oauth-service/oauth/access_token';
const ACTIVITIES_URL = 'https://apis.garmin.com/wellness-api/rest/activities';

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

function db(env) {
  if (!env.DB) fail('D1 尚未綁定。請建立 run-app 資料庫並執行 schema.sql', 503);
  return env.DB;
}

function enc(value) {
  return encodeURIComponent(String(value))
    .replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

async function oauthHeader(method, url, { consumerKey, consumerSecret, token, tokenSecret, extra = {} }) {
  const oauth = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: crypto.randomUUID().replace(/-/g, ''),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_version: '1.0',
    ...extra,
  };
  if (token) oauth.oauth_token = token;
  const param = Object.keys(oauth).sort().map(k => `${enc(k)}=${enc(oauth[k])}`).join('&');
  const base = `${method.toUpperCase()}&${enc(url)}&${enc(param)}`;
  const signingKey = `${enc(consumerSecret)}&${enc(tokenSecret || '')}`;
  const cryptoKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(signingKey), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(base));
  let bin = '';
  new Uint8Array(mac).forEach(b => { bin += String.fromCharCode(b); });
  oauth.oauth_signature = btoa(bin);
  return `OAuth ${Object.keys(oauth).sort().map(k => `${enc(k)}="${enc(oauth[k])}"`).join(', ')}`;
}

async function oauthForm(url, auth) {
  const res = await fetch(url, { method: 'POST', headers: { Authorization: auth } });
  const text = await res.text();
  if (!res.ok) fail(`Garmin 拒絕要求（${res.status}）${text ? '：' + text.slice(0, 180) : ''}`, 502);
  return Object.fromEntries(new URLSearchParams(text));
}

function sidOf(body) {
  const sid = String(body.sid || '').trim();
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(sid)) fail('缺少工作階段編號', 400);
  return sid;
}

function isRun(activity) {
  const type = activity.activityType;
  const key = typeof type === 'string' ? type : (type && (type.typeKey || type.typeId)) || '';
  return /run|jog|trail|treadmill|track/i.test(`${key} ${activity.activityName || ''}`);
}

function toRun(activity) {
  const start = Number(activity.startTimeInSeconds);
  const offset = Number(activity.startTimeOffsetInSeconds) || 0;
  if (!start) return null;
  const local = new Date((start + offset) * 1000);
  const p = n => String(n).padStart(2, '0');
  const date = `${local.getUTCFullYear()}-${p(local.getUTCMonth() + 1)}-${p(local.getUTCDate())}`;
  const meters = Number(activity.distanceInMeters);
  const sec = Number(activity.durationInSeconds);
  if (!(meters > 0) || !(sec > 0)) return null;
  const hr = Number(activity.averageHeartRateInBeatsPerMinute);
  return {
    activityId: activity.activityId || activity.summaryId || null,
    date,
    distanceKm: Math.round(meters / 10) / 100,
    durationSec: Math.round(sec),
    avgHr: hr > 0 ? Math.round(hr) : null,
    note: activity.activityName ? String(activity.activityName).slice(0, 80) : '',
    source: 'garmin',
  };
}

async function pullActivities(env, accessToken, accessSecret) {
  const { key, secret } = secrets(env);
  const now = Math.floor(Date.now() / 1000);
  const seen = new Set();
  const runs = [];
  for (let i = 0; i < 14; i++) {
    const end = now - i * 86400;
    const start = end - 86400;
    const query = { uploadStartTimeInSeconds: String(start), uploadEndTimeInSeconds: String(end) };
    const header = await oauthHeader('GET', ACTIVITIES_URL, {
      consumerKey: key, consumerSecret: secret, token: accessToken, tokenSecret: accessSecret, extra: query,
    });
    const res = await fetch(`${ACTIVITIES_URL}?uploadStartTimeInSeconds=${start}&uploadEndTimeInSeconds=${end}`, { headers: { Authorization: header } });
    const text = await res.text();
    if (res.status === 401 || res.status === 403) fail('Garmin 授權已失效，請重新連結', 401);
    if (!res.ok) continue;
    let list = [];
    try { list = JSON.parse(text); } catch { continue; }
    if (!Array.isArray(list)) continue;
    for (const activity of list) {
      if (!isRun(activity)) continue;
      const run = toRun(activity);
      if (!run) continue;
      const dedupe = String(run.activityId || `${run.date}|${run.distanceKm}`);
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      runs.push(run);
    }
  }
  return runs;
}

export async function handleGarmin(request, env, url) {
  const { key, secret } = secrets(env);
  const database = db(env);
  const body = request.method === 'GET' ? {} : await request.json().catch(() => ({}));

  if (url.pathname === '/garmin/start' && request.method === 'POST') {
    const sid = sidOf(body);
    const header = await oauthHeader('POST', REQUEST_TOKEN_URL, {
      consumerKey: key, consumerSecret: secret, extra: { oauth_callback: CALLBACK },
    });
    const token = await oauthForm(REQUEST_TOKEN_URL, header);
    if (!token.oauth_token || !token.oauth_token_secret) fail('Garmin 沒有回傳要求權杖', 502);
    await database.prepare(`INSERT INTO garmin_oauth (sid, request_token, request_secret, access_token, access_secret, updated_at)
      VALUES (?, ?, ?, NULL, NULL, ?)
      ON CONFLICT(sid) DO UPDATE SET request_token=excluded.request_token, request_secret=excluded.request_secret, access_token=NULL, access_secret=NULL, updated_at=excluded.updated_at`)
      .bind(sid, token.oauth_token, token.oauth_token_secret, new Date().toISOString()).run();
    return { authorizeUrl: `${AUTHORIZE_URL}?oauth_token=${encodeURIComponent(token.oauth_token)}` };
  }

  if (url.pathname === '/garmin/complete' && request.method === 'POST') {
    const sid = sidOf(body);
    const oauthToken = String(body.oauth_token || '');
    const verifier = String(body.oauth_verifier || '');
    if (!oauthToken || !verifier) fail('Garmin 沒有完成授權', 400);
    const row = await database.prepare('SELECT request_token, request_secret FROM garmin_oauth WHERE sid=?').bind(sid).first();
    if (!row || !row.request_secret || row.request_token !== oauthToken) fail('找不到這次連結工作階段，請再按一次連結 Garmin', 400);
    const header = await oauthHeader('POST', ACCESS_TOKEN_URL, {
      consumerKey: key,
      consumerSecret: secret,
      token: oauthToken,
      tokenSecret: row.request_secret,
      extra: { oauth_verifier: verifier },
    });
    const access = await oauthForm(ACCESS_TOKEN_URL, header);
    if (!access.oauth_token || !access.oauth_token_secret) fail('Garmin 沒有回傳存取權杖', 502);
    await database.prepare('UPDATE garmin_oauth SET access_token=?, access_secret=?, request_token=NULL, request_secret=NULL, updated_at=? WHERE sid=?')
      .bind(access.oauth_token, access.oauth_token_secret, new Date().toISOString(), sid).run();
    return { connected: true };
  }

  if (url.pathname === '/garmin/status' && request.method === 'POST') {
    const sid = sidOf(body);
    const row = await database.prepare('SELECT access_token FROM garmin_oauth WHERE sid=?').bind(sid).first();
    return { connected: !!(row && row.access_token) };
  }

  if (url.pathname === '/garmin/disconnect' && request.method === 'POST') {
    const sid = sidOf(body);
    await database.prepare('DELETE FROM garmin_oauth WHERE sid=?').bind(sid).run();
    return { connected: false };
  }

  if (url.pathname === '/garmin/sync' && request.method === 'POST') {
    const sid = sidOf(body);
    const row = await database.prepare('SELECT access_token, access_secret FROM garmin_oauth WHERE sid=?').bind(sid).first();
    if (!row || !row.access_token || !row.access_secret) fail('尚未連結 Garmin', 401);
    const runs = await pullActivities(env, row.access_token, row.access_secret);
    return { connected: true, runs };
  }

  fail('找不到', 404);
}
