import { handleGarmin, disconnectUser } from './garmin.js';
import {
  PASSWORD_ITERATIONS,
  SESSION_MS,
  hashPassword,
  hashToken,
  normalizeEmail,
  passwordOk,
  randomHex,
  randomToken,
  verifyPassword,
} from './passwords.js';
import { getSettings, listCrossTraining, listRuns, putSync } from './runs.js';
import { getGoal, putGoal } from './goal.js';

const DEFAULT_ORIGINS = [
  'https://helloajchu-png.github.io',
  'https://run-together.pages.dev',
  'https://run-together-app.pages.dev',
];
const RATES = {
  login: { limit: 10, windowMs: 15 * 60 * 1000 },
  register: { limit: 5, windowMs: 60 * 60 * 1000 },
};
const DUMMY_SALT = '11'.repeat(16);
const LOCKED_MESSAGE = '想看其他跑者的動態、週跑量與配速，請先打開「公開」。公開之後，你只看得到同樣公開的人。關掉公開，你的動態會立刻從別人那裡消失。';

function fail(message, status) {
  const err = new Error(message);
  err.status = status;
  throw err;
}

function configuredOrigins(env) {
  return String((env && env.ALLOWED_ORIGIN) || '').split(',').map(s => s.trim()).filter(Boolean);
}

function allowOrigin(env, request) {
  const configured = configuredOrigins(env);
  const list = [...new Set([...DEFAULT_ORIGINS, ...configured])];
  const origin = request.headers.get('Origin');
  if (origin && list.includes(origin)) return origin;
  return configured[0] || DEFAULT_ORIGINS[0];
}

function json(request, env, data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': allowOrigin(env, request),
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
      'Vary': 'Origin',
      'Cache-Control': 'no-store',
    },
  });
}

function clientIp(request) {
  const raw = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'local';
  return String(raw).split(',')[0].trim().slice(0, 64) || 'local';
}

function publicUser(row) {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    isPublic: Number(row.is_public) === 1,
  };
}

function cleanName(value, fallback) {
  const name = String(value ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 16);
  return name || String(fallback || '').slice(0, 16) || '跑者';
}

function bearer(request) {
  const header = request.headers.get('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token || token.length < 20 || token.length > 200) return '';
  return token;
}

async function userFrom(request, env) {
  const token = bearer(request);
  if (!token || !env.DB) return null;
  const row = await env.DB.prepare(`SELECT a.* FROM auth_sessions s
    JOIN accounts a ON a.id=s.user_id
    WHERE s.token_hash=? AND s.expires_at>?`).bind(await hashToken(token), new Date().toISOString()).first();
  return row || null;
}

async function rateOk(env, request, action, consume) {
  const rule = RATES[action];
  const bucket = `${action}:${clientIp(request)}`;
  const now = Date.now();
  const row = await env.DB.prepare('SELECT hits, reset_at FROM rate_limits WHERE bucket=?').bind(bucket).first();
  const fresh = !row || Number(row.reset_at) <= now;
  const hits = fresh ? 0 : Number(row.hits);
  if (hits >= rule.limit) return false;
  if (!consume) return true;
  const nextHits = hits + 1;
  const resetAt = fresh ? now + rule.windowMs : Number(row.reset_at);
  await env.DB.prepare(`INSERT INTO rate_limits (bucket, hits, reset_at) VALUES (?, ?, ?)
    ON CONFLICT(bucket) DO UPDATE SET hits=excluded.hits, reset_at=excluded.reset_at`).bind(bucket, nextHits, resetAt).run();
  return true;
}

async function issueSession(env, userId) {
  const token = randomToken();
  const now = new Date();
  await env.DB.prepare('INSERT INTO auth_sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .bind(await hashToken(token), userId, now.toISOString(), new Date(now.getTime() + SESSION_MS).toISOString()).run();
  return token;
}

async function register(request, env, body) {
  if (!(await rateOk(env, request, 'register', true))) fail('嘗試太多次，請稍後再試', 429);
  const email = normalizeEmail(body.email);
  const password = String(body.password ?? '');
  if (!email) fail('請填寫有效的電子郵件', 400);
  if (!passwordOk(password)) fail('密碼至少 8 碼', 400);
  const exists = await env.DB.prepare('SELECT id FROM accounts WHERE email=?').bind(email).first();
  if (exists) fail('這個電子郵件已經註冊', 409);
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const salt = randomHex(16);
  const passwordHash = await hashPassword(password, salt, PASSWORD_ITERATIONS);
  const displayName = cleanName(body.displayName, email.split('@')[0]);
  await env.DB.prepare(`INSERT INTO accounts (id, email, password_hash, password_salt, password_iterations, display_name, is_public, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`).bind(id, email, passwordHash, salt, PASSWORD_ITERATIONS, displayName, now, now).run();
  const token = await issueSession(env, id);
  const user = await env.DB.prepare('SELECT * FROM accounts WHERE id=?').bind(id).first();
  return { token, user: publicUser(user) };
}

async function login(request, env, body) {
  if (!(await rateOk(env, request, 'login', true))) fail('嘗試太多次，請稍後再試', 429);
  const email = normalizeEmail(body.email);
  const password = String(body.password ?? '');
  if (!email || !password) {
    await verifyPassword(password || 'missing-password', DUMMY_SALT, '', PASSWORD_ITERATIONS);
    fail('電子郵件或密碼不對', 401);
  }
  const row = await env.DB.prepare('SELECT * FROM accounts WHERE email=?').bind(email).first();
  const salt = row ? row.password_salt : DUMMY_SALT;
  const expected = row ? row.password_hash : '';
  const iterations = Number(row && row.password_iterations) || PASSWORD_ITERATIONS;
  const ok = await verifyPassword(password, salt, expected, iterations);
  if (!row || !ok) fail('電子郵件或密碼不對', 401);
  await env.DB.prepare('DELETE FROM auth_sessions WHERE user_id=? AND expires_at<=?').bind(row.id, new Date().toISOString()).run();
  const token = await issueSession(env, row.id);
  return { token, user: publicUser(row) };
}

async function logout(request, env) {
  const token = bearer(request);
  if (token) await env.DB.prepare('DELETE FROM auth_sessions WHERE token_hash=?').bind(await hashToken(token)).run();
  return { ok: true };
}

async function updateMe(env, me, body) {
  const displayName = 'displayName' in body ? cleanName(body.displayName, me.display_name) : me.display_name;
  let isPublic = Number(me.is_public) === 1 ? 1 : 0;
  if ('isPublic' in body) isPublic = body.isPublic === true || body.isPublic === 1 || body.isPublic === '1' || body.isPublic === 'true' ? 1 : 0;
  await env.DB.prepare('UPDATE accounts SET display_name=?, is_public=?, updated_at=? WHERE id=?')
    .bind(displayName, isPublic, new Date().toISOString(), me.id).run();
  return publicUser(await env.DB.prepare('SELECT * FROM accounts WHERE id=?').bind(me.id).first());
}

async function changePassword(request, env, me, body) {
  if (!(await rateOk(env, request, 'login', false))) fail('嘗試太多次，請稍後再試', 429);
  const current = String(body.currentPassword ?? '');
  const next = String(body.newPassword ?? '');
  if (!passwordOk(next)) fail('新密碼至少 8 碼', 400);
  const row = await env.DB.prepare('SELECT * FROM accounts WHERE id=?').bind(me.id).first();
  if (!(await verifyPassword(current, row.password_salt, row.password_hash, Number(row.password_iterations) || PASSWORD_ITERATIONS))) {
    await rateOk(env, request, 'login', true);
    fail('目前密碼不對', 401);
  }
  const salt = randomHex(16);
  const passwordHash = await hashPassword(next, salt, PASSWORD_ITERATIONS);
  const token = bearer(request);
  const tokenHash = token ? await hashToken(token) : '';
  await env.DB.prepare('UPDATE accounts SET password_hash=?, password_salt=?, password_iterations=?, updated_at=? WHERE id=?')
    .bind(passwordHash, salt, PASSWORD_ITERATIONS, new Date().toISOString(), me.id).run();
  await env.DB.prepare('DELETE FROM auth_sessions WHERE user_id=? AND token_hash<>?').bind(me.id, tokenHash).run();
  return { ok: true };
}

async function removeAccount(request, env, me, body) {
  if (!(await rateOk(env, request, 'login', false))) fail('嘗試太多次，請稍後再試', 429);
  const row = await env.DB.prepare('SELECT * FROM accounts WHERE id=?').bind(me.id).first();
  if (!(await verifyPassword(String(body.password ?? ''), row.password_salt, row.password_hash, Number(row.password_iterations) || PASSWORD_ITERATIONS))) {
    await rateOk(env, request, 'login', true);
    fail('密碼不對', 401);
  }
  await disconnectUser(env, me.id, { purgeActivities: true });
  const posts = await env.DB.prepare('SELECT id FROM feed_posts WHERE user_id=?').bind(me.id).all();
  for (const post of posts.results || []) {
    await env.DB.prepare('DELETE FROM feed_likes WHERE post_id=?').bind(post.id).run();
  }
  await env.DB.prepare('DELETE FROM feed_likes WHERE user_id=?').bind(me.id).run();
  await env.DB.prepare('DELETE FROM feed_posts WHERE user_id=?').bind(me.id).run();
  await env.DB.prepare('DELETE FROM user_runs WHERE user_id=?').bind(me.id).run();
  await env.DB.prepare('DELETE FROM cross_training WHERE user_id=?').bind(me.id).run();
  await env.DB.prepare('DELETE FROM user_settings WHERE user_id=?').bind(me.id).run();
  await env.DB.prepare('DELETE FROM goal_profiles WHERE user_id=?').bind(me.id).run();
  await env.DB.prepare('DELETE FROM auth_sessions WHERE user_id=?').bind(me.id).run();
  await env.DB.prepare('DELETE FROM accounts WHERE id=?').bind(me.id).run();
  return { ok: true };
}

function isoDay(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : new Date().toISOString().slice(0, 10);
}

function shiftDay(iso, days) {
  const [year, month, day] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function fmtPace(sec, km) {
  if (!(km > 0) || !(sec > 0)) return '—';
  const total = Math.round(sec / km);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}/km`;
}

function mapPost(row) {
  return {
    id: row.id,
    displayName: row.display_name || '跑者',
    kind: row.kind,
    body: row.body,
    km: row.km,
    pace: row.pace,
    createdAt: row.created_at,
    likeCount: Number(row.like_count || 0),
    liked: Number(row.liked || 0) > 0,
  };
}

async function ownPosts(env, userId) {
  const rows = await env.DB.prepare(`SELECT p.id, p.kind, p.body, p.km, p.pace, p.created_at, a.display_name,
      (SELECT COUNT(*) FROM feed_likes l WHERE l.post_id=p.id) AS like_count,
      (SELECT COUNT(*) FROM feed_likes l WHERE l.post_id=p.id AND l.user_id=?) AS liked
    FROM feed_posts p JOIN accounts a ON a.id=p.user_id
    WHERE p.user_id=? ORDER BY p.created_at DESC LIMIT 20`).bind(userId, userId).all();
  return (rows.results || []).map(mapPost);
}

async function publicFeed(env, me, today) {
  const rows = await env.DB.prepare(`SELECT p.id, p.kind, p.body, p.km, p.pace, p.created_at, a.display_name,
      (SELECT COUNT(*) FROM feed_likes l WHERE l.post_id=p.id) AS like_count,
      (SELECT COUNT(*) FROM feed_likes l WHERE l.post_id=p.id AND l.user_id=?) AS liked
    FROM feed_posts p JOIN accounts a ON a.id=p.user_id
    WHERE a.is_public=1
    ORDER BY p.created_at DESC LIMIT 50`).bind(me.id).all();
  const people = await env.DB.prepare('SELECT id, display_name FROM accounts WHERE is_public=1 ORDER BY display_name LIMIT 100').all();
  const stats = await env.DB.prepare(`SELECT r.user_id, r.distance_km, r.duration_sec
    FROM user_runs r JOIN accounts a ON a.id=r.user_id
    WHERE a.is_public=1 AND r.run_date>=? AND r.run_date<=?`).bind(shiftDay(today, -6), today).all();
  const totals = new Map();
  for (const row of stats.results || []) {
    const cur = totals.get(row.user_id) || { km: 0, sec: 0 };
    cur.km += Number(row.distance_km) || 0;
    cur.sec += Number(row.duration_sec) || 0;
    totals.set(row.user_id, cur);
  }
  const athletes = (people.results || []).map(person => {
    const cur = totals.get(person.id) || { km: 0, sec: 0 };
    return {
      displayName: person.display_name || '跑者',
      weeklyKm: Math.round(cur.km * 10) / 10,
      avgPace: fmtPace(cur.sec, cur.km),
      mine: person.id === me.id,
    };
  });
  return {
    viewerPublic: true,
    locked: false,
    posts: (rows.results || []).map(mapPost),
    ownPosts: [],
    athletes,
    message: '',
  };
}

async function feedFor(env, me, today) {
  if (Number(me.is_public) !== 1) {
    return { viewerPublic: false, locked: true, posts: [], ownPosts: await ownPosts(env, me.id), athletes: [], message: LOCKED_MESSAGE };
  }
  return publicFeed(env, me, today);
}

async function createPost(env, me, body) {
  const text = String(body.body || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 500);
  if (!text) fail('沒有內容', 400);
  const id = crypto.randomUUID();
  const kind = body.kind === 'week' ? 'week' : 'run';
  const km = body.km == null || body.km === '' ? null : Number(body.km);
  const pace = body.pace ? String(body.pace).slice(0, 20) : null;
  await env.DB.prepare('INSERT INTO feed_posts (id, user_id, kind, body, km, pace, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(id, me.id, kind, text, Number.isFinite(km) ? km : null, pace, new Date().toISOString()).run();
  return { id };
}

async function toggleLike(env, me, postId) {
  const post = await env.DB.prepare(`SELECT p.id, p.user_id, a.is_public AS author_public
    FROM feed_posts p JOIN accounts a ON a.id=p.user_id WHERE p.id=?`).bind(postId).first();
  if (!post) fail('找不到動態', 404);
  const own = post.user_id === me.id;
  if (!own && (Number(me.is_public) !== 1 || Number(post.author_public) !== 1)) fail('公開後才能對其他人按讚', 403);
  const existing = await env.DB.prepare('SELECT user_id FROM feed_likes WHERE post_id=? AND user_id=?').bind(postId, me.id).first();
  if (existing) await env.DB.prepare('DELETE FROM feed_likes WHERE post_id=? AND user_id=?').bind(postId, me.id).run();
  else await env.DB.prepare('INSERT INTO feed_likes (post_id, user_id, created_at) VALUES (?, ?, ?)').bind(postId, me.id, new Date().toISOString()).run();
  return { ok: true };
}

function errorResponse(request, env, err) {
  const message = String(err && err.message || err);
  if (/no such table/i.test(message)) {
    return json(request, env, { error: '資料表尚未更新，請在 worker 目錄執行 wrangler d1 migrations apply' }, 503);
  }
  if (err && err.status) return json(request, env, { error: err.message }, err.status);
  console.error(err);
  return json(request, env, { error: '伺服器暫時無法處理' }, 500);
}

async function garminResponse(request, env, url) {
  try {
    const user = url.pathname === '/garmin/push' ? null : await userFrom(request, env);
    if (url.pathname !== '/garmin/push' && !user) return json(request, env, { error: '請先登入' }, 401);
    return json(request, env, await handleGarmin(request, env, url, user));
  } catch (err) {
    const missing = /no such table|garmin_oauth|D1/i.test(String(err && err.message || err));
    if (missing) return json(request, env, { error: 'Garmin 資料表尚未建立，請執行 migrations' }, err.status || 503);
    return errorResponse(request, env, err);
  }
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return json(request, env, { ok: true });
    const url = new URL(request.url);
    try {
      if (url.pathname === '/health') return json(request, env, { ok: true, mode: env.DB ? 'd1' : 'no-db', garmin: true, auth: true });
      if (url.pathname.startsWith('/garmin/')) return garminResponse(request, env, url);
      const body = request.method === 'GET' ? {} : await request.json().catch(() => ({}));
      if (url.pathname === '/auth/register' && request.method === 'POST') return json(request, env, await register(request, env, body));
      if (url.pathname === '/auth/login' && request.method === 'POST') return json(request, env, await login(request, env, body));
      if (url.pathname === '/auth/logout' && request.method === 'POST') return json(request, env, await logout(request, env));

      const me = await userFrom(request, env);
      if (!me) return json(request, env, { error: '請先登入' }, 401);
      if (url.pathname === '/me' && request.method === 'GET') return json(request, env, publicUser(me));
      if (url.pathname === '/me' && request.method === 'PUT') return json(request, env, await updateMe(env, me, body));
      if (url.pathname === '/auth/change-password' && request.method === 'POST') return json(request, env, await changePassword(request, env, me, body));
      if (url.pathname === '/auth/delete-account' && request.method === 'POST') return json(request, env, await removeAccount(request, env, me, body));
      if (url.pathname === '/goal' && request.method === 'GET') {
        return json(request, env, { goalProfile: await getGoal(env.DB, me.id) });
      }
      if (url.pathname === '/goal' && request.method === 'PUT') {
        return json(request, env, { goalProfile: await putGoal(env.DB, me.id, body.goalProfile || body) });
      }
      if (url.pathname === '/sync' && request.method === 'GET') {
        return json(request, env, { runs: await listRuns(env.DB, me.id), crossTraining: await listCrossTraining(env.DB, me.id), settings: await getSettings(env.DB, me.id), goalProfile: await getGoal(env.DB, me.id) });
      }
      if (url.pathname === '/sync' && request.method === 'PUT') {
        const saved = await putSync(env.DB, me.id, body);
        if (body.goalProfile && typeof body.goalProfile === 'object') saved.goalProfile = await putGoal(env.DB, me.id, body.goalProfile);
        else saved.goalProfile = await getGoal(env.DB, me.id);
        return json(request, env, saved);
      }
      if (url.pathname === '/posts' && request.method === 'POST') return json(request, env, await createPost(env, me, body));
      const like = url.pathname.match(/^\/posts\/([^/]+)\/like$/);
      if (like && request.method === 'POST') return json(request, env, await toggleLike(env, me, decodeURIComponent(like[1])));
      if (url.pathname === '/feed' && request.method === 'GET') return json(request, env, await feedFor(env, me, isoDay(url.searchParams.get('today'))));
      return json(request, env, { error: '找不到' }, 404);
    } catch (err) {
      return errorResponse(request, env, err);
    }
  },
};
