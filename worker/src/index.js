import { handleGarmin } from './garmin.js';

const ORIGIN = 'https://helloajchu-png.github.io';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': ORIGIN,
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    },
  });
}

async function hashPin(nickname, pin, salt) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: new TextEncoder().encode(salt + '|' + nickname.toLowerCase()), iterations: 100000, hash: 'SHA-256' }, key, 256);
  return [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function id() {
  return crypto.randomUUID();
}

async function userFrom(request, env) {
  const h = request.headers.get('Authorization') || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!token) return null;
  return env.DB.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=?`).bind(token).first();
}

function pub(u) {
  return { nickname: u.nickname, displayName: u.display_name, weeklyKm: u.weekly_km, avgPace: u.avg_pace, goalRace: u.goal_race, planBlurb: u.plan_blurb || '', visibility: u.visibility || 'friends' };
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return json({ ok: true });
    const url = new URL(request.url);
    try {
      if (url.pathname === '/health') return json({ ok: true, mode: env.DB ? 'd1' : 'no-db', garmin: true });
      if (url.pathname.startsWith('/garmin/')) {
        try {
          return json(await handleGarmin(request, env, url));
        } catch (err) {
          const missing = /no such table|Garmin_oauth|D1/i.test(String(err && err.message || err));
          const message = missing ? 'garmin_oauth 資料表尚未建立，請執行 schema.sql' : String(err && err.message || err);
          return json({ error: message }, err.status || (missing ? 503 : 500));
        }
      }
      const body = request.method === 'GET' ? {} : await request.json().catch(() => ({}));

      if (url.pathname === '/auth/register' && request.method === 'POST') {
        const nickname = String(body.nickname || '').trim();
        const pin = String(body.pin || '');
        if (!/^.{2,16}$/.test(nickname) || !/^\d{4}$/.test(pin)) return json({ error: '暱稱 2–16 字，PIN 為 4 位數字' }, 400);
        const exists = await env.DB.prepare('SELECT id FROM users WHERE nickname=? COLLATE NOCASE').bind(nickname).first();
        if (exists) return json({ error: '這個暱稱已被使用' }, 409);
        const salt = id();
        const pinHash = await hashPin(nickname, pin, salt);
        const uid = id();
        const now = new Date().toISOString();
        await env.DB.prepare('INSERT INTO users (id,nickname,pin_hash,pin_salt,display_name,visibility,created_at) VALUES (?,?,?,?,?,?,?)').bind(uid, nickname, pinHash, salt, String(body.displayName || nickname).slice(0, 16), 'friends', now).run();
        const token = id() + id();
        await env.DB.prepare('INSERT INTO sessions (token,user_id,created_at) VALUES (?,?,?)').bind(token, uid, now).run();
        const user = await env.DB.prepare('SELECT * FROM users WHERE id=?').bind(uid).first();
        return json({ token, user: pub(user) });
      }

      if (url.pathname === '/auth/login' && request.method === 'POST') {
        const nickname = String(body.nickname || '').trim();
        const pin = String(body.pin || '');
        const user = await env.DB.prepare('SELECT * FROM users WHERE nickname=? COLLATE NOCASE').bind(nickname).first();
        if (!user || await hashPin(nickname, pin, user.pin_salt) !== user.pin_hash) return json({ error: '暱稱或 PIN 不對' }, 401);
        const token = id() + id();
        await env.DB.prepare('INSERT INTO sessions (token,user_id,created_at) VALUES (?,?,?)').bind(token, user.id, new Date().toISOString()).run();
        return json({ token, user: pub(user) });
      }

      const me = await userFrom(request, env);
      if (!me) return json({ error: '請先進入' }, 401);

      if (url.pathname === '/me' && request.method === 'GET') return json(pub(me));
      if (url.pathname === '/me' && request.method === 'PUT') {
        await env.DB.prepare('UPDATE users SET display_name=?, weekly_km=?, avg_pace=?, goal_race=?, plan_blurb=?, visibility=? WHERE id=?').bind(
          String(body.displayName || me.display_name).slice(0, 16),
          Number(body.weeklyKm) || 0,
          String(body.avgPace || ''),
          String(body.goalRace || ''),
          String(body.planBlurb || '').slice(0, 280),
          'friends',
          me.id
        ).run();
        return json(pub(await env.DB.prepare('SELECT * FROM users WHERE id=?').bind(me.id).first()));
      }

      if (url.pathname === '/friends' && request.method === 'POST') {
        const nickname = String(body.nickname || '').trim();
        const other = await env.DB.prepare('SELECT * FROM users WHERE nickname=? COLLATE NOCASE').bind(nickname).first();
        if (!other) return json({ error: '找不到這個暱稱' }, 404);
        if (other.id === me.id) return json({ error: '不能加自己' }, 400);
        const now = new Date().toISOString();
        await env.DB.prepare('INSERT OR IGNORE INTO friends (user_id,friend_id,created_at) VALUES (?,?,?)').bind(me.id, other.id, now).run();
        await env.DB.prepare('INSERT OR IGNORE INTO friends (user_id,friend_id,created_at) VALUES (?,?,?)').bind(other.id, me.id, now).run();
        return json({ ok: true, nickname: other.nickname });
      }

      if (url.pathname === '/posts' && request.method === 'POST') {
        const kind = body.kind === 'week' ? 'week' : 'run';
        const text = String(body.body || '').slice(0, 500);
        if (!text) return json({ error: '沒有內容' }, 400);
        const pid = id();
        await env.DB.prepare('INSERT INTO posts (id,user_id,kind,body,km,pace,created_at) VALUES (?,?,?,?,?,?,?)').bind(pid, me.id, kind, text, body.km == null ? null : Number(body.km), body.pace ? String(body.pace) : null, new Date().toISOString()).run();
        return json({ id: pid });
      }

      const like = url.pathname.match(/^\/posts\/([^/]+)\/like$/);
      if (like && request.method === 'POST') {
        const pid = decodeURIComponent(like[1]);
        const row = await env.DB.prepare('SELECT user_id FROM likes WHERE post_id=? AND user_id=?').bind(pid, me.id).first();
        if (row) await env.DB.prepare('DELETE FROM likes WHERE post_id=? AND user_id=?').bind(pid, me.id).run();
        else await env.DB.prepare('INSERT INTO likes (post_id,user_id,created_at) VALUES (?,?,?)').bind(pid, me.id, new Date().toISOString()).run();
        return json({ ok: true });
      }

      if (url.pathname === '/feed' && request.method === 'GET') {
        const rows = await env.DB.prepare(`
          SELECT p.id, p.kind, p.body, p.km, p.pace, p.created_at, u.nickname, u.display_name,
            (SELECT COUNT(*) FROM likes l WHERE l.post_id=p.id) AS like_count,
            (SELECT COUNT(*) FROM likes l WHERE l.post_id=p.id AND l.user_id=?) AS liked
          FROM posts p JOIN users u ON u.id=p.user_id
          WHERE p.user_id=? OR p.user_id IN (SELECT friend_id FROM friends WHERE user_id=?)
          ORDER BY p.created_at DESC LIMIT 50
        `).bind(me.id, me.id, me.id).all();
        const posts = (rows.results || []).map(p => ({
          id: p.id, nickname: p.nickname, displayName: p.display_name, kind: p.kind, body: p.body,
          km: p.km, pace: p.pace, createdAt: p.created_at, likes: Array(p.liked ? 1 : 0).fill(me.nickname).concat(Array(Math.max(0, p.like_count - (p.liked ? 1 : 0))).fill(''))
        }));
        return json({ posts });
      }

      return json({ error: '找不到' }, 404);
    } catch (err) {
      return json({ error: String(err && err.message || err) }, 500);
    }
  },
};
