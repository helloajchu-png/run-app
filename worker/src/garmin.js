// Garmin Connect Developer Program — OAuth 2.0 PKCE.
// Endpoints below are copied from Garmin's OAuth2.0 PKCE Specification PDF
// (developerportal.garmin.com/sites/default/files/OAuth2PKCE.pdf).
// Starter access is push-only and does not include historical data
// (developer.garmin.com/gc-developer-program). This file does not call a
// history download. Push payload fields are not in that public PDF, so the
// parser only keeps an item when it already looks like a run.
//
// The OAuth tokens and Garmin user id live on the logged-in account
// (garmin_oauth.user_id). Any device with that account reads the same
// connection. POST /garmin/push stays unauthenticated because Garmin calls it.
//
// Secrets, set with wrangler and never committed:
//   GARMIN_CONSUMER_KEY    (OAuth client_id)
//   GARMIN_CONSUMER_SECRET (OAuth client_secret)

import { mirrorGarminRun } from './runs.js';

// This is the redirect URI registered with Garmin. The browser returns here
// with ?code=&state=. Do not point it at Pages unless that exact URL
// (including the trailing slash) is added in the Garmin developer portal.
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

function activityTypeKey(activity) {
  const type = activity.activityType;
  if (typeof type === 'string') return type;
  if (type && typeof type === 'object') return String(type.typeKey || type.typeId || '');
  return '';
}

function activityText(activity) {
  return `${activityTypeKey(activity)} ${activity.activityName || ''}`.toLowerCase().replace(/[_-]+/g, ' ');
}

function looksLikeRun(activity) {
  const text = activityText(activity);
  if (/cycl|bik|elliptical|rowing|stair|cardio/.test(text)) return false;
  return /run|jog|trail|treadmill|track/.test(text);
}

// Cycling (outdoor, indoor, virtual), elliptical, rowing, and similar cardio.
// Running stays on the run path. Walking, swimming, and strength are ignored.
export function cardioSport(activity) {
  if (looksLikeRun(activity)) return null;
  const text = activityText(activity);
  if (/indoor cycl|virtual ride|virtual cycl|spinning|spin class/.test(text)) return { sport: 'indoor_cycling', label: '室內自行車' };
  if (/cycl|bik|\bride\b/.test(text)) return { sport: 'cycling', label: '自行車' };
  if (/elliptical/.test(text)) return { sport: 'elliptical', label: '滑步機' };
  if (/rowing|\brow\b/.test(text)) return { sport: 'rowing', label: '划船' };
  if (/stair/.test(text)) return { sport: 'stair', label: '階梯機' };
  if (/jump rope|jumping rope/.test(text)) return { sport: 'cardio', label: '跳繩' };
  if (/cardio|fitness equipment/.test(text)) return { sport: 'cardio', label: '室內有氧' };
  return null;
}

function activityWhen(activity) {
  const start = Number(activity.startTimeInSeconds);
  const offset = Number(activity.startTimeOffsetInSeconds) || 0;
  const sec = Number(activity.durationInSeconds);
  if (!start || !(sec > 0)) return null;
  const local = new Date((start + offset) * 1000);
  const p = n => String(n).padStart(2, '0');
  const meters = Number(activity.distanceInMeters);
  const hr = Number(activity.averageHeartRateInBeatsPerMinute);
  return {
    summaryId: String(activity.summaryId || activity.activityId || `${start}|${sec}`),
    activityId: activity.activityId || activity.summaryId || null,
    date: `${local.getUTCFullYear()}-${p(local.getUTCMonth() + 1)}-${p(local.getUTCDate())}`,
    distanceKm: meters > 0 ? Math.round(meters / 10) / 100 : null,
    durationSec: Math.round(sec),
    avgHr: hr > 0 ? Math.round(hr) : null,
    note: activity.activityName ? String(activity.activityName).slice(0, 80) : '',
    source: 'garmin',
  };
}

function toRun(activity) {
  if (!looksLikeRun(activity)) return null;
  const when = activityWhen(activity);
  if (!when || !(when.distanceKm > 0)) return null;
  return when;
}

function toCardio(activity) {
  const sport = cardioSport(activity);
  if (!sport) return null;
  const when = activityWhen(activity);
  if (!when) return null;
  return { ...when, sport: sport.sport, label: sport.label };
}

function garminClientId(summaryId) {
  return ('garmin-' + String(summaryId || '')).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80);
}

// userId on push/ping items is stated in Garmin's OAuth2 PKCE PDF.
// Other property names are read only when present. They are not listed on the
// public Activity API page checked on 2026-11-09. A callbackURL without a
// summary is a ping; Starter is push-only, so it is not fetched.
export function runsFromPush(body) {
  const items = [];
  const lists = Array.isArray(body) ? [body] : (body && typeof body === 'object' ? Object.values(body) : []);
  for (const value of lists) {
    if (Array.isArray(value)) items.push(...value.filter(item => item && typeof item === 'object'));
  }
  const runs = [];
  const cross = [];
  let ping = 0;
  let skipped = 0;
  for (const item of items) {
    if (item.callbackURL && item.distanceInMeters == null && item.durationInSeconds == null) { ping++; continue; }
    if (!item.userId) { skipped++; continue; }
    const run = toRun(item);
    if (run) { runs.push({ userId: String(item.userId), ...run }); continue; }
    const cardio = toCardio(item);
    if (cardio) { cross.push({ userId: String(item.userId), ...cardio }); continue; }
    skipped++;
  }
  return { runs, cross, ping, skipped, received: items.length };
}

async function garminOwner(db, garminUserId) {
  const mapped = await db.prepare('SELECT user_id FROM garmin_oauth WHERE garmin_user_id=? AND user_id IS NOT NULL LIMIT 1').bind(garminUserId).first();
  const known = mapped || await db.prepare('SELECT sid FROM garmin_oauth WHERE garmin_user_id=? LIMIT 1').bind(garminUserId).first();
  return { mapped, known };
}

async function storePushedRuns(env, parsed) {
  const db = database(env);
  let stored = 0;
  let storedCross = 0;
  let unmatched = 0;
  for (const run of parsed.runs) {
    const { mapped, known } = await garminOwner(db, run.userId);
    if (!known) { unmatched++; continue; }
    const result = await db.prepare(`INSERT OR IGNORE INTO garmin_activities
      (id, garmin_user_id, summary_id, activity_date, distance_km, duration_sec, avg_hr, note, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
      crypto.randomUUID(), run.userId, run.summaryId, run.date, run.distanceKm, run.durationSec, run.avgHr, run.note, new Date().toISOString()
    ).run();
    if (result && result.meta && result.meta.changes) stored++;
    if (mapped && mapped.user_id) {
      try { await mirrorGarminRun(db, mapped.user_id, run); } catch { /* inbox still has the activity */ }
    }
  }
  for (const item of parsed.cross || []) {
    const { mapped, known } = await garminOwner(db, item.userId);
    if (!known) { unmatched++; continue; }
    const clientId = garminClientId(item.summaryId);
    if (clientId.length < 8) { unmatched++; continue; }
    const result = await db.prepare(`INSERT OR IGNORE INTO cross_training
      (id, user_id, garmin_user_id, client_id, summary_id, activity_date, sport, label, duration_sec, distance_km, avg_hr, note, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
      crypto.randomUUID(),
      mapped && mapped.user_id ? mapped.user_id : null,
      item.userId,
      clientId,
      item.summaryId,
      item.date,
      item.sport,
      item.label,
      item.durationSec,
      item.distanceKm,
      item.avgHr,
      item.note,
      new Date().toISOString()
    ).run();
    if (result && result.meta && result.meta.changes) storedCross++;
    if (mapped && mapped.user_id) {
      await db.prepare('UPDATE cross_training SET user_id=? WHERE garmin_user_id=? AND summary_id=? AND user_id IS NULL')
        .bind(mapped.user_id, item.userId, item.summaryId).run();
    }
  }
  return { ok: true, stored, storedCross, unmatched, ping: parsed.ping, skipped: parsed.skipped, received: parsed.received };
}

async function accountLink(env, userId) {
  return database(env).prepare(`SELECT * FROM garmin_oauth
    WHERE user_id=? AND access_token IS NOT NULL
    ORDER BY updated_at DESC LIMIT 1`).bind(userId).first();
}

async function linkStatus(env, user) {
  const row = await accountLink(env, user.id);
  return { connected: !!(row && row.access_token) };
}

function mapCrossRow(row) {
  return {
    id: row.client_id,
    activityId: row.summary_id,
    date: row.activity_date,
    sport: row.sport,
    label: row.label,
    durationSec: Number(row.duration_sec),
    distanceKm: row.distance_km == null ? null : Number(row.distance_km),
    avgHr: row.avg_hr == null ? null : Number(row.avg_hr),
    note: row.note || '',
    source: 'garmin',
  };
}

async function inbox(env, user) {
  const row = await accountLink(env, user.id);
  if (!row) return { connected: false, runs: [], crossTraining: [] };
  if (!row.garmin_user_id) return { connected: true, runs: [], crossTraining: [] };
  const db = database(env);
  const rows = await db.prepare(`SELECT summary_id, activity_date, distance_km, duration_sec, avg_hr, note
    FROM garmin_activities WHERE garmin_user_id=? ORDER BY activity_date DESC LIMIT 100`).bind(row.garmin_user_id).all();
  const runs = (rows.results || []).map(r => ({
    activityId: r.summary_id, date: r.activity_date, distanceKm: r.distance_km, durationSec: r.duration_sec, avgHr: r.avg_hr, note: r.note || '', source: 'garmin',
  }));
  const crossRows = await db.prepare(`SELECT client_id, summary_id, activity_date, sport, label, duration_sec, distance_km, avg_hr, note
    FROM cross_training WHERE garmin_user_id=? ORDER BY activity_date DESC LIMIT 100`).bind(row.garmin_user_id).all();
  return { connected: true, runs, crossTraining: (crossRows.results || []).map(mapCrossRow) };
}

async function beginLink(env, user) {
  const { key } = secrets(env);
  const db = database(env);
  const { verifier, challenge } = await pkce();
  const state = b64url(crypto.getRandomValues(new Uint8Array(24)));
  const now = new Date().toISOString();
  const existing = await db.prepare('SELECT sid FROM garmin_oauth WHERE user_id=? ORDER BY updated_at DESC LIMIT 1').bind(user.id).first();
  if (existing) {
    await db.prepare('UPDATE garmin_oauth SET state=?, code_verifier=?, updated_at=? WHERE sid=?')
      .bind(state, verifier, now, existing.sid).run();
  } else {
    const sid = crypto.randomUUID().replace(/-/g, '');
    await db.prepare(`INSERT INTO garmin_oauth (sid, state, code_verifier, access_token, refresh_token, expires_at, garmin_user_id, updated_at, user_id)
      VALUES (?, ?, ?, NULL, NULL, NULL, NULL, ?, ?)`)
      .bind(sid, state, verifier, now, user.id).run();
  }
  const authorizeUrl = `${AUTHORIZE_URL}?response_type=code&client_id=${enc(key)}&code_challenge=${enc(challenge)}&code_challenge_method=S256&redirect_uri=${enc(CALLBACK)}&state=${enc(state)}`;
  return { authorizeUrl };
}

async function finishLink(env, user, body) {
  secrets(env);
  const code = String(body.code || '');
  const state = String(body.state || '');
  if (!code || !state) fail('Garmin 沒有完成授權', 400);
  const db = database(env);
  const row = await db.prepare('SELECT sid, state, code_verifier FROM garmin_oauth WHERE user_id=? AND state=?').bind(user.id, state).first();
  if (!row || !row.code_verifier) fail('找不到這次連結工作階段，請再按一次連結 Garmin', 400);
  const data = await tokenRequest(env, {
    grant_type: 'authorization_code',
    code,
    code_verifier: row.code_verifier,
    redirect_uri: CALLBACK,
  });
  await saveTokens(env, row.sid, data);
  let garminUserId = null;
  const who = await fetch(USER_ID_URL, { headers: { Authorization: `Bearer ${data.access_token}` } });
  if (who.ok) {
    const info = await who.json().catch(() => ({}));
    garminUserId = info.userId || null;
  }
  if (!garminUserId) fail('Garmin 沒有回傳使用者編號', 502);
  const other = await db.prepare('SELECT user_id FROM garmin_oauth WHERE garmin_user_id=? AND user_id IS NOT NULL AND user_id<>?').bind(String(garminUserId), user.id).first();
  if (other) fail('這個 Garmin 已經連結到別的帳號', 409);
  await db.prepare('UPDATE garmin_oauth SET garmin_user_id=? WHERE sid=?').bind(String(garminUserId), row.sid).run();
  return { connected: true };
}

export async function deregisterRemote(env, userId) {
  const db = database(env);
  const rows = await db.prepare('SELECT * FROM garmin_oauth WHERE user_id=?').bind(userId).all();
  for (const row of rows.results || []) {
    if (!row.access_token) continue;
    try {
      const token = await bearer(env, row);
      await fetch(DEREGISTER_URL, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    } catch { /* local rows are removed even if Garmin is unreachable */ }
  }
}

export async function disconnectUser(env, userId, { purgeActivities = false } = {}) {
  const db = database(env);
  const rows = await db.prepare('SELECT * FROM garmin_oauth WHERE user_id=?').bind(userId).all();
  const links = rows.results || [];
  await deregisterRemote(env, userId);
  const garminIds = [...new Set(links.map(row => row.garmin_user_id).filter(Boolean))];
  await db.prepare('DELETE FROM garmin_oauth WHERE user_id=?').bind(userId).run();
  if (purgeActivities) {
    for (const garminUserId of garminIds) {
      await db.prepare('DELETE FROM garmin_activities WHERE garmin_user_id=?').bind(garminUserId).run();
      await db.prepare('DELETE FROM cross_training WHERE garmin_user_id=?').bind(garminUserId).run();
    }
  }
  return { connected: false };
}

async function claim(env, user, body) {
  const sid = sidOf(body);
  const db = database(env);
  const row = await db.prepare('SELECT sid, user_id, access_token FROM garmin_oauth WHERE sid=?').bind(sid).first();
  if (!row) return { connected: false };
  if (row.user_id && row.user_id !== user.id) fail('這組連結已屬於別的帳號', 409);
  if (!row.user_id) {
    const mine = await accountLink(env, user.id);
    if (!mine) await db.prepare('UPDATE garmin_oauth SET user_id=?, updated_at=? WHERE sid=?').bind(user.id, new Date().toISOString(), sid).run();
  }
  return linkStatus(env, user);
}

export async function handleGarmin(request, env, url, user) {
  const body = request.method === 'GET' ? {} : await request.json().catch(() => ({}));

  if (url.pathname === '/garmin/push' && request.method === 'POST') {
    return storePushedRuns(env, runsFromPush(body));
  }
  if (!user) fail('請先登入', 401);
  if (url.pathname === '/garmin/start' && request.method === 'POST') return beginLink(env, user);
  if (url.pathname === '/garmin/complete' && request.method === 'POST') return finishLink(env, user, body);
  if (url.pathname === '/garmin/status' && request.method === 'POST') return linkStatus(env, user);
  if (url.pathname === '/garmin/disconnect' && request.method === 'POST') return disconnectUser(env, user.id);
  if (url.pathname === '/garmin/claim' && request.method === 'POST') return claim(env, user, body);
  if ((url.pathname === '/garmin/inbox' || url.pathname === '/garmin/sync') && request.method === 'POST') return inbox(env, user);
  fail('找不到', 404);
}
