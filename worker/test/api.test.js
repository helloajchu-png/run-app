import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashToken } from '../src/passwords.js';
import { call, createEnv } from './helpers.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

async function withEnv(fn) {
  const env = await createEnv();
  try { await fn(env); } finally { env.close(); }
}

async function register(env, email, password, displayName) {
  const res = await call(env, '/auth/register', { method: 'POST', body: { email, password, displayName } });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  return res.data;
}

test('migration file is additive', () => {
  const sql = readFileSync(join(root, 'migrations/002_accounts.sql'), 'utf8');
  assert.doesNotMatch(sql, /drop\s+table/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS accounts/);
  assert.match(sql, /ALTER TABLE garmin_oauth ADD COLUMN user_id/);
});

test('register stores a hash, login is case-insensitive, and the session token is hashed', async () => {
  await withEnv(async env => {
    const created = await register(env, 'Aj@Example.com', 'correct-horse', '阿哲');
    assert.equal(created.user.email, 'aj@example.com');
    assert.equal(created.user.displayName, '阿哲');
    assert.equal(created.user.isPublic, false);
    assert.equal(created.user.password_hash, undefined);
    const row = env.raw.prepare('SELECT email, password_hash, password_salt FROM accounts').get();
    assert.equal(row.email, 'aj@example.com');
    assert.notEqual(row.password_hash, 'correct-horse');
    assert.equal(row.password_hash.length, 64);
    assert.equal(row.password_salt.length, 32);
    const session = env.raw.prepare('SELECT token_hash FROM auth_sessions').get();
    assert.notEqual(session.token_hash, created.token);
    assert.equal(session.token_hash, await hashToken(created.token));

    const again = await call(env, '/auth/register', { method: 'POST', body: { email: 'aj@example.com', password: 'correct-horse' } });
    assert.equal(again.status, 409);
    const logged = await call(env, '/auth/login', { method: 'POST', body: { email: 'AJ@example.com', password: 'correct-horse' } });
    assert.equal(logged.status, 200);
    const bad = await call(env, '/auth/login', { method: 'POST', body: { email: 'aj@example.com', password: 'wrong-password' } });
    assert.equal(bad.status, 401);
    const me = await call(env, '/me', { token: logged.data.token });
    assert.equal(me.status, 200);
    assert.equal(me.data.email, 'aj@example.com');
  });
});

test('login and signup are rate limited', async () => {
  await withEnv(async env => {
    for (let i = 0; i < 5; i++) {
      const res = await call(env, '/auth/register', { method: 'POST', body: { email: `u${i}@example.com`, password: 'correct-horse' } });
      assert.equal(res.status, 200);
    }
    const blocked = await call(env, '/auth/register', { method: 'POST', body: { email: 'u6@example.com', password: 'correct-horse' } });
    assert.equal(blocked.status, 429);
  });
  await withEnv(async env => {
    await register(env, 'a@example.com', 'correct-horse');
    for (let i = 0; i < 10; i++) {
      const res = await call(env, '/auth/login', { method: 'POST', body: { email: 'a@example.com', password: 'wrong-password' } });
      assert.equal(res.status, 401);
    }
    const blocked = await call(env, '/auth/login', { method: 'POST', body: { email: 'a@example.com', password: 'correct-horse' } });
    assert.equal(blocked.status, 429);
  });
});

test('logout, password change, and delete revoke access without touching another user', async () => {
  await withEnv(async env => {
    const first = await register(env, 'a@example.com', 'correct-horse', '阿哲');
    const second = await call(env, '/auth/login', { method: 'POST', body: { email: 'a@example.com', password: 'correct-horse' } });
    await call(env, '/sync', { method: 'PUT', token: first.token, body: { runs: [{ id: 'run-a', date: '2026-11-01', distanceKm: 8, durationSec: 2400, note: 'A-secret' }] } });
    const other = await register(env, 'b@example.com', 'other-horse', '小林');
    await call(env, '/sync', { method: 'PUT', token: other.token, body: { runs: [{ id: 'run-b', date: '2026-11-02', distanceKm: 5, durationSec: 1800, note: 'B-secret' }] } });

    const changed = await call(env, '/auth/change-password', {
      method: 'POST', token: first.token, body: { currentPassword: 'correct-horse', newPassword: 'new-horse-1' },
    });
    assert.equal(changed.status, 200);
    assert.equal((await call(env, '/me', { token: second.data.token })).status, 401);
    assert.equal((await call(env, '/me', { token: first.token })).status, 200);
    assert.equal((await call(env, '/auth/login', { method: 'POST', body: { email: 'a@example.com', password: 'correct-horse' } })).status, 401);
    const relogin = await call(env, '/auth/login', { method: 'POST', body: { email: 'a@example.com', password: 'new-horse-1' } });
    assert.equal(relogin.status, 200);

    await call(env, '/auth/logout', { method: 'POST', token: relogin.data.token });
    assert.equal((await call(env, '/me', { token: relogin.data.token })).status, 401);

    const fresh = await call(env, '/auth/login', { method: 'POST', body: { email: 'a@example.com', password: 'new-horse-1' } });
    const wrongDelete = await call(env, '/auth/delete-account', { method: 'POST', token: fresh.data.token, body: { password: 'nope-nope' } });
    assert.equal(wrongDelete.status, 401);
    assert.equal((await call(env, '/sync', { token: fresh.data.token })).data.runs.length, 1);
    const removed = await call(env, '/auth/delete-account', { method: 'POST', token: fresh.data.token, body: { password: 'new-horse-1' } });
    assert.equal(removed.status, 200);
    assert.equal((await call(env, '/auth/login', { method: 'POST', body: { email: 'a@example.com', password: 'new-horse-1' } })).status, 401);
    const kept = await call(env, '/sync', { token: other.token });
    assert.equal(kept.data.runs.length, 1);
    assert.equal(kept.data.runs[0].note, 'B-secret');
  });
});

test('deleting an account removes every owned row and leaves everyone else', async () => {
  await withEnv(async env => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('garmin down'); };
    try {
      const owner = await register(env, 'owner@example.com', 'correct-horse', '阿哲');
      const other = await register(env, 'other@example.com', 'other-horse', '別人');
      await call(env, '/auth/login', { method: 'POST', body: { email: 'owner@example.com', password: 'correct-horse' } });
      await call(env, '/sync', {
        method: 'PUT', token: owner.token,
        body: {
          runs: [{ id: 'owner-run', date: '2026-11-12', distanceKm: 6, durationSec: 1800, avgHr: 150, note: 'owner-run' }],
          settings: { planBlurb: 'owner-plan', coachUrl: 'https://coach.example/owner' },
        },
      });
      await call(env, '/sync', {
        method: 'PUT', token: other.token,
        body: {
          runs: [{ id: 'other-run', date: '2026-11-12', distanceKm: 4, durationSec: 1400, note: 'other-run' }],
          settings: { planBlurb: 'other-plan' },
        },
      });
      await call(env, '/goal', { method: 'PUT', token: owner.token, body: { distance: '10k', targetSec: 3600, daysPerWeek: 4, level: 'intermediate' } });
      await call(env, '/goal', { method: 'PUT', token: other.token, body: { distance: '5k', daysPerWeek: 3, level: 'beginner' } });
      const ownerPost = await call(env, '/posts', { method: 'POST', token: owner.token, body: { kind: 'run', body: 'owner finished', km: 6 } });
      const otherPost = await call(env, '/posts', { method: 'POST', token: other.token, body: { kind: 'run', body: 'other finished', km: 4 } });
      assert.equal(ownerPost.status, 200);
      await call(env, '/posts/' + ownerPost.data.id + '/like', { method: 'POST', token: owner.token });
      await call(env, '/posts/' + otherPost.data.id + '/like', { method: 'POST', token: other.token });
      await call(env, '/posts/' + ownerPost.data.id + '/like', { method: 'POST', token: other.token, body: {} });

      const now = new Date().toISOString();
      const ownerId = owner.user.id;
      const otherId = other.user.id;
      const insertUser = env.raw.prepare('INSERT INTO users (id, nickname, pin_hash, pin_salt, display_name, created_at) VALUES (?, ?, ?, ?, ?, ?)');
      insertUser.run(ownerId, 'legacy-owner', 'hash', 'salt', '阿哲', now);
      insertUser.run(otherId, 'legacy-other', 'hash', 'salt', '別人', now);
      insertUser.run('legacy-third', 'legacy-third', 'hash', 'salt', '第三者', now);
      env.raw.prepare('INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)').run('sess-owner', ownerId, now);
      env.raw.prepare('INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)').run('sess-other', otherId, now);
      env.raw.prepare('INSERT INTO friends (user_id, friend_id, created_at) VALUES (?, ?, ?)').run(ownerId, otherId, now);
      env.raw.prepare('INSERT INTO friends (user_id, friend_id, created_at) VALUES (?, ?, ?)').run(otherId, 'legacy-third', now);
      env.raw.prepare('INSERT INTO posts (id, user_id, kind, body, created_at) VALUES (?, ?, ?, ?, ?)').run('legacy-post-owner', ownerId, 'run', 'old owner', now);
      env.raw.prepare('INSERT INTO posts (id, user_id, kind, body, created_at) VALUES (?, ?, ?, ?, ?)').run('legacy-post-other', otherId, 'run', 'old other', now);
      env.raw.prepare('INSERT INTO likes (post_id, user_id, created_at) VALUES (?, ?, ?)').run('legacy-post-owner', otherId, now);
      env.raw.prepare('INSERT INTO likes (post_id, user_id, created_at) VALUES (?, ?, ?)').run('legacy-post-other', ownerId, now);
      env.raw.prepare('INSERT INTO likes (post_id, user_id, created_at) VALUES (?, ?, ?)').run('legacy-post-other', otherId, now);
      env.raw.prepare(`INSERT INTO garmin_oauth (sid, user_id, garmin_user_id, access_token, expires_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`).run('sid-owner', ownerId, 'garmin-owner', 'stale-token', '2099-01-01T00:00:00.000Z', now);
      env.raw.prepare(`INSERT INTO garmin_oauth (sid, user_id, garmin_user_id, access_token, expires_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`).run('sid-other', otherId, 'garmin-other', 'other-token', '2099-01-01T00:00:00.000Z', now);
      env.raw.prepare(`INSERT INTO garmin_activities (id, garmin_user_id, summary_id, activity_date, distance_km, duration_sec, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).run('act-owner', 'garmin-owner', 'sum-owner', '2026-11-12', 6, 1800, now);
      env.raw.prepare(`INSERT INTO garmin_activities (id, garmin_user_id, summary_id, activity_date, distance_km, duration_sec, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).run('act-other', 'garmin-other', 'sum-other', '2026-11-12', 4, 1400, now);
      const cross = env.raw.prepare(`INSERT INTO cross_training (id, user_id, garmin_user_id, client_id, summary_id, activity_date, sport, label, duration_sec, distance_km, avg_hr, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      cross.run('cross-owner', ownerId, 'garmin-owner', 'garmin-cross-owner', 'cross-owner', '2026-11-12', 'cycling', '自行車', 2400, 20, 130, 'ride', now);
      cross.run('cross-orphan', null, 'garmin-owner', 'garmin-cross-orphan', 'cross-orphan', '2026-11-11', 'elliptical', '滑步機', 900, null, null, '', now);
      cross.run('cross-other', otherId, 'garmin-other', 'garmin-cross-other', 'cross-other', '2026-11-12', 'rowing', '划船', 1200, 3, 140, 'row', now);
      env.raw.prepare('INSERT INTO rate_limits (bucket, hits, reset_at) VALUES (?, ?, ?)').run('login:keep', 1, Date.now() + 60000);

      const owned = () => ({
        accounts: env.raw.prepare('SELECT COUNT(*) AS n FROM accounts WHERE id=?').get(ownerId).n,
        sessionsAuth: env.raw.prepare('SELECT COUNT(*) AS n FROM auth_sessions WHERE user_id=?').get(ownerId).n,
        runs: env.raw.prepare('SELECT COUNT(*) AS n FROM user_runs WHERE user_id=?').get(ownerId).n,
        settings: env.raw.prepare('SELECT COUNT(*) AS n FROM user_settings WHERE user_id=?').get(ownerId).n,
        goals: env.raw.prepare('SELECT COUNT(*) AS n FROM goal_profiles WHERE user_id=?').get(ownerId).n,
        posts: env.raw.prepare('SELECT COUNT(*) AS n FROM feed_posts WHERE user_id=?').get(ownerId).n,
        likes: env.raw.prepare('SELECT COUNT(*) AS n FROM feed_likes WHERE user_id=? OR post_id IN (SELECT id FROM feed_posts WHERE user_id=?)').get(ownerId, ownerId).n,
        cross: env.raw.prepare('SELECT COUNT(*) AS n FROM cross_training WHERE user_id=? OR garmin_user_id=?').get(ownerId, 'garmin-owner').n,
        oauth: env.raw.prepare('SELECT COUNT(*) AS n FROM garmin_oauth WHERE user_id=?').get(ownerId).n,
        activities: env.raw.prepare('SELECT COUNT(*) AS n FROM garmin_activities WHERE garmin_user_id=?').get('garmin-owner').n,
        legacyUser: env.raw.prepare('SELECT COUNT(*) AS n FROM users WHERE id=?').get(ownerId).n,
        legacySession: env.raw.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id=?').get(ownerId).n,
        legacyFriends: env.raw.prepare('SELECT COUNT(*) AS n FROM friends WHERE user_id=? OR friend_id=?').get(ownerId, ownerId).n,
        legacyPosts: env.raw.prepare('SELECT COUNT(*) AS n FROM posts WHERE user_id=?').get(ownerId).n,
        legacyLikes: env.raw.prepare('SELECT COUNT(*) AS n FROM likes WHERE user_id=? OR post_id IN (SELECT id FROM posts WHERE user_id=?)').get(ownerId, ownerId).n,
      });
      const before = owned();
      for (const [key, value] of Object.entries(before)) assert.ok(value >= 1, key + ' should start with a row');

      const wrong = await call(env, '/auth/delete-account', { method: 'POST', token: owner.token, body: { password: 'wrong-password' } });
      assert.equal(wrong.status, 401);
      assert.deepEqual(owned(), before);

      const removed = await call(env, '/auth/delete-account', { method: 'POST', token: owner.token, body: { password: 'correct-horse' } });
      assert.equal(removed.status, 200);
      assert.equal(removed.data.deleted, true);
      const after = owned();
      for (const [key, value] of Object.entries(after)) assert.equal(value, 0, key);

      assert.equal(env.raw.prepare('SELECT COUNT(*) AS n FROM accounts WHERE id=?').get(otherId).n, 1);
      assert.equal(env.raw.prepare('SELECT COUNT(*) AS n FROM user_runs WHERE user_id=?').get(otherId).n, 1);
      assert.equal(env.raw.prepare('SELECT note FROM user_runs WHERE user_id=?').get(otherId).note, 'other-run');
      assert.equal(env.raw.prepare('SELECT plan_blurb FROM user_settings WHERE user_id=?').get(otherId).plan_blurb, 'other-plan');
      assert.equal(env.raw.prepare('SELECT distance FROM goal_profiles WHERE user_id=?').get(otherId).distance, '5k');
      assert.equal(env.raw.prepare('SELECT COUNT(*) AS n FROM feed_posts WHERE user_id=?').get(otherId).n, 1);
      assert.equal(env.raw.prepare('SELECT COUNT(*) AS n FROM feed_likes WHERE user_id=?').get(otherId).n, 1);
      assert.equal(env.raw.prepare('SELECT COUNT(*) AS n FROM cross_training WHERE user_id=?').get(otherId).n, 1);
      assert.equal(env.raw.prepare('SELECT label FROM cross_training WHERE user_id=?').get(otherId).label, '划船');
      assert.equal(env.raw.prepare('SELECT garmin_user_id FROM garmin_oauth WHERE user_id=?').get(otherId).garmin_user_id, 'garmin-other');
      assert.equal(env.raw.prepare('SELECT COUNT(*) AS n FROM garmin_activities WHERE garmin_user_id=?').get('garmin-other').n, 1);
      assert.equal(env.raw.prepare('SELECT nickname FROM users WHERE id=?').get(otherId).nickname, 'legacy-other');
      assert.equal(env.raw.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id=?').get(otherId).n, 1);
      assert.equal(env.raw.prepare('SELECT COUNT(*) AS n FROM friends WHERE user_id=? AND friend_id=?').get(otherId, 'legacy-third').n, 1);
      assert.equal(env.raw.prepare('SELECT body FROM posts WHERE id=?').get('legacy-post-other').body, 'old other');
      assert.equal(env.raw.prepare('SELECT COUNT(*) AS n FROM likes WHERE post_id=? AND user_id=?').get('legacy-post-other', otherId).n, 1);
      assert.equal(env.raw.prepare('SELECT hits FROM rate_limits WHERE bucket=?').get('login:keep').hits, 1);
      assert.equal((await call(env, '/auth/login', { method: 'POST', body: { email: 'owner@example.com', password: 'correct-horse' } })).status, 401);
      assert.equal((await call(env, '/sync', { token: other.token })).data.runs.length, 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test('user B cannot read or delete user A runs, and date plus distance dedupes', async () => {
  await withEnv(async env => {
    const a = await register(env, 'a@example.com', 'correct-horse');
    const b = await register(env, 'b@example.com', 'other-horse');
    const saved = await call(env, '/sync', {
      method: 'PUT', token: a.token,
      body: {
        runs: [
          { id: 'run-a', date: '2026-11-02', distanceKm: 10, durationSec: 3000, note: 'A-secret-note' },
          { id: 'run-dup', date: '2026-11-02', distanceKm: 10.02, durationSec: 3100, note: 'duplicate' },
        ],
        settings: { goal: { dist: 42.195, date: '2026-12-20', sec: 14340, days: '5' } },
      },
    });
    assert.equal(saved.status, 200);
    assert.equal(saved.data.runs.length, 1);
    assert.equal(saved.data.runs[0].note, 'A-secret-note');
    assert.equal(saved.data.settings.goal.dist, 42.195);

    const edited = await call(env, '/sync', {
      method: 'PUT', token: a.token,
      body: { runs: [{ id: 'run-a', date: '2026-11-02', distanceKm: 10, durationSec: 2900, note: 'edited' }] },
    });
    assert.equal(edited.data.runs.length, 1);
    assert.equal(edited.data.runs[0].note, 'edited');

    const merged = await call(env, '/sync', {
      method: 'PUT', token: a.token,
      body: { mode: 'merge', runs: [{ id: 'run-c', date: '2026-11-03', distanceKm: 6, durationSec: 2000, note: 'third' }], deletedIds: ['run-a'] },
    });
    assert.equal(merged.data.runs.length, 2);

    const seen = await call(env, '/sync', { token: b.token });
    assert.equal(seen.status, 200);
    assert.deepEqual(seen.data.runs, []);
    assert.equal(JSON.stringify(seen.data).includes('A-secret-note'), false);
    assert.equal(JSON.stringify(seen.data).includes('edited'), false);
    await call(env, '/sync', { method: 'PUT', token: b.token, body: { runs: [], deletedIds: ['run-a'] } });
    const still = await call(env, '/sync', { token: a.token });
    assert.equal(still.data.runs.map(run => run.id).sort().join(','), 'run-a,run-c');
    assert.equal(still.data.settings.goal.date, '2026-12-20');
  });
});

test('a private user sees nobody else, and a public user sees only public users', async () => {
  await withEnv(async env => {
    const secret = await register(env, 'secret@example.com', 'correct-horse', '祕密跑者');
    const openA = await register(env, 'a@example.com', 'correct-horse', '阿哲');
    const openC = await register(env, 'c@example.com', 'correct-horse', '小林');
    assert.equal((await call(env, '/me', { method: 'PUT', token: openA.token, body: { isPublic: true } })).data.isPublic, true);
    assert.equal((await call(env, '/me', { method: 'PUT', token: openC.token, body: { isPublic: true } })).data.isPublic, true);

    await call(env, '/posts', { method: 'POST', token: secret.token, body: { kind: 'run', body: '秘密長跑內容', km: 30, pace: '6:00/km' } });
    await call(env, '/posts', { method: 'POST', token: openC.token, body: { kind: 'run', body: '小林的晨跑', km: 12, pace: '5:20/km' } });
    await call(env, '/sync', { method: 'PUT', token: secret.token, body: { runs: [{ id: 'secret-run', date: '2026-11-09', distanceKm: 30, durationSec: 10800 }] } });
    await call(env, '/sync', { method: 'PUT', token: openC.token, body: { runs: [{ id: 'c-run', date: '2026-11-09', distanceKm: 12.5, durationSec: 4125 }] } });

    const hidden = await call(env, '/feed?today=2026-11-10', { token: secret.token });
    assert.equal(hidden.data.locked, true);
    assert.equal(hidden.data.viewerPublic, false);
    assert.deepEqual(hidden.data.posts, []);
    assert.deepEqual(hidden.data.athletes, []);
    assert.match(hidden.data.message, /公開/);
    assert.equal(JSON.stringify(hidden.data).includes('小林的晨跑'), false);
    assert.equal(JSON.stringify(hidden.data).includes('a@example.com'), false);
    assert.equal(hidden.data.ownPosts.length, 1);

    const visible = await call(env, '/feed?today=2026-11-10', { token: openA.token });
    assert.equal(visible.data.locked, false);
    assert.equal(visible.data.posts.some(post => post.body === '小林的晨跑'), true);
    assert.equal(visible.data.posts.some(post => post.body === '秘密長跑內容'), false);
    assert.equal(JSON.stringify(visible.data).includes('secret@example.com'), false);
    const names = visible.data.athletes.map(person => person.displayName);
    assert.equal(names.includes('小林'), true);
    assert.equal(names.includes('阿哲'), true);
    assert.equal(names.includes('祕密跑者'), false);
    const lin = visible.data.athletes.find(person => person.displayName === '小林');
    assert.equal(lin.weeklyKm, 12.5);
    assert.equal(lin.avgPace, '5:30/km');

    await call(env, '/me', { method: 'PUT', token: openC.token, body: { isPublic: false } });
    const after = await call(env, '/feed?today=2026-11-10', { token: openA.token });
    assert.equal(after.data.posts.some(post => post.body === '小林的晨跑'), false);
    assert.equal(after.data.athletes.some(person => person.displayName === '小林'), false);
  });
});

test('CORS allows GitHub Pages and Cloudflare Pages', async () => {
  await withEnv(async env => {
    const evil = await call(env, '/health', { headers: { Origin: 'https://evil.example' } });
    assert.equal(evil.headers.get('Access-Control-Allow-Origin'), 'https://helloajchu-png.github.io');
    const pages = await call(env, '/health', { headers: { Origin: 'https://helloajchu-png.github.io' } });
    assert.equal(pages.headers.get('Access-Control-Allow-Origin'), 'https://helloajchu-png.github.io');
    const next = await call(env, '/health', { headers: { Origin: 'https://run-together.pages.dev' } });
    assert.equal(next.headers.get('Access-Control-Allow-Origin'), 'https://run-together.pages.dev');
    const fallback = await call(env, '/health', { headers: { Origin: 'https://run-together-app.pages.dev' } });
    assert.equal(fallback.headers.get('Access-Control-Allow-Origin'), 'https://run-together-app.pages.dev');
    assert.equal(pages.data.auth, true);
    env.ALLOWED_ORIGIN = 'https://preview.example';
    const preview = await call(env, '/health', { headers: { Origin: 'https://preview.example' } });
    assert.equal(preview.headers.get('Access-Control-Allow-Origin'), 'https://preview.example');
    const stillEvil = await call(env, '/health', { headers: { Origin: 'https://evil.example' } });
    assert.equal(stillEvil.headers.get('Access-Control-Allow-Origin'), 'https://preview.example');
  });
});

test('Garmin connection is stored on the account and follows a new login', async () => {
  await withEnv(async env => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async url => {
      const target = String(url);
      if (target.includes('/oauth/token')) {
        return new Response(JSON.stringify({ access_token: 'access-token-test', refresh_token: 'refresh-token-test', expires_in: 3600 }), { status: 200 });
      }
      if (target.includes('/user/id')) return new Response(JSON.stringify({ userId: 'garmin-user-1' }), { status: 200 });
      if (target.includes('/user/registration')) return new Response(null, { status: 204 });
      return new Response('unexpected ' + target, { status: 500 });
    };
    try {
      const owner = await register(env, 'owner@example.com', 'correct-horse', '阿哲');
      const other = await register(env, 'other@example.com', 'other-horse', '別人');
      assert.equal((await call(env, '/garmin/status', { method: 'POST', body: {} })).status, 401);

      const start = await call(env, '/garmin/start', { method: 'POST', token: owner.token, body: {} });
      assert.equal(start.status, 200);
      const authorize = new URL(start.data.authorizeUrl);
      assert.equal(authorize.searchParams.get('redirect_uri'), 'https://helloajchu-png.github.io/run-app/');
      const state = authorize.searchParams.get('state');
      const done = await call(env, '/garmin/complete', { method: 'POST', token: owner.token, body: { code: 'auth-code', state } });
      assert.equal(done.status, 200);
      assert.equal(done.data.connected, true);
      assert.equal(done.data.access_token, undefined);

      const stored = env.raw.prepare('SELECT user_id, access_token, refresh_token, garmin_user_id FROM garmin_oauth').get();
      assert.equal(stored.user_id, owner.user.id);
      assert.equal(stored.access_token, 'access-token-test');
      assert.equal(stored.refresh_token, 'refresh-token-test');
      assert.equal(stored.garmin_user_id, 'garmin-user-1');

      const pushed = await call(env, '/garmin/push', {
        method: 'POST',
        body: {
          activities: [
            {
              userId: 'garmin-user-1', summaryId: 'sum-1', activityType: 'RUNNING', activityName: 'Morning Run',
              startTimeInSeconds: 1735689600, startTimeOffsetInSeconds: 0, distanceInMeters: 10000,
              durationInSeconds: 3600, averageHeartRateInBeatsPerMinute: 142,
            },
            {
              userId: 'garmin-user-1', summaryId: 'bike-1', activityType: 'CYCLING', activityName: 'Ride',
              startTimeInSeconds: 1735689600, distanceInMeters: 20000, durationInSeconds: 3600,
              averageHeartRateInBeatsPerMinute: 128,
            },
            {
              userId: 'garmin-user-1', summaryId: 'yoga-1', activityType: 'YOGA', activityName: 'Yoga',
              startTimeInSeconds: 1735689600, durationInSeconds: 1800,
            },
          ],
        },
      });
      assert.equal(pushed.status, 200);
      assert.equal(pushed.data.stored, 1);
      assert.equal(pushed.data.storedCross, 1);
      assert.ok(pushed.data.skipped >= 1);
      assert.equal(env.raw.prepare('SELECT COUNT(*) AS n FROM feed_posts').get().n, 0);
      assert.equal(env.raw.prepare('SELECT SUM(distance_km) AS km FROM user_runs').get().km, 10);

      const phone = await call(env, '/auth/login', { method: 'POST', body: { email: 'owner@example.com', password: 'correct-horse' } });
      const status = await call(env, '/garmin/status', { method: 'POST', token: phone.data.token, body: {} });
      assert.equal(status.data.connected, true);
      assert.equal(status.data.access_token, undefined);
      assert.equal(JSON.stringify(status.data).includes('access-token-test'), false);
      const inbox = await call(env, '/garmin/inbox', { method: 'POST', token: phone.data.token, body: {} });
      assert.equal(inbox.data.connected, true);
      assert.equal(inbox.data.runs.length, 1);
      assert.equal(inbox.data.runs[0].distanceKm, 10);
      assert.equal(inbox.data.runs[0].date, '2025-01-01');
      assert.equal(inbox.data.runs[0].note, 'Morning Run');
      assert.equal(inbox.data.crossTraining.length, 1);
      assert.equal(inbox.data.crossTraining[0].label, '自行車');
      assert.equal(inbox.data.crossTraining[0].sport, 'cycling');
      assert.equal(inbox.data.crossTraining[0].distanceKm, 20);
      assert.equal(inbox.data.crossTraining[0].avgHr, 128);
      assert.equal(inbox.data.crossTraining[0].id.startsWith('garmin-'), true);

      const synced = await call(env, '/sync', { token: phone.data.token });
      assert.equal(synced.data.runs.length, 1);
      assert.equal(synced.data.runs[0].source, 'garmin');
      assert.equal(synced.data.runs[0].note, 'Morning Run');
      assert.equal(synced.data.crossTraining.length, 1);
      assert.equal(synced.data.crossTraining[0].label, '自行車');
      assert.equal(synced.data.runs.some(run => run.note === 'Ride'), false);

      const strangerStatus = await call(env, '/garmin/status', { method: 'POST', token: other.token, body: {} });
      assert.equal(strangerStatus.data.connected, false);
      const strangerInbox = await call(env, '/garmin/inbox', { method: 'POST', token: other.token, body: {} });
      assert.deepEqual(strangerInbox.data.runs, []);
      const strangerSync = await call(env, '/sync', { token: other.token });
      assert.deepEqual(strangerSync.data.runs, []);
      assert.deepEqual(strangerSync.data.crossTraining, []);
      assert.equal(JSON.stringify(strangerSync.data).includes('Morning Run'), false);
      assert.equal(JSON.stringify(strangerSync.data).includes('自行車'), false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test('Garmin cardio is stored as cross-training and stays out of running totals', async () => {
  await withEnv(async env => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response('unused', { status: 500 });
    try {
      const owner = await register(env, 'cardio@example.com', 'correct-horse', '阿哲');
      const other = await register(env, 'nocardio@example.com', 'other-horse', '別人');
      env.raw.prepare('INSERT INTO garmin_oauth (sid, user_id, garmin_user_id, access_token, updated_at) VALUES (?, ?, ?, ?, ?)')
        .run('sid-cardio', owner.user.id, 'garmin-cardio', 'token', new Date().toISOString());
      const now = Math.floor(Date.now() / 1000);
      const pushed = await call(env, '/garmin/push', {
        method: 'POST',
        body: {
          activities: [
            { userId: 'garmin-cardio', summaryId: 'cycle-out', activityType: 'CYCLING', activityName: 'Afternoon Ride', startTimeInSeconds: now, durationInSeconds: 5400, distanceInMeters: 25000, averageHeartRateInBeatsPerMinute: 130 },
            { userId: 'garmin-cardio', summaryId: 'cycle-in', activityType: 'INDOOR_CYCLING', activityName: 'Virtual Ride', startTimeInSeconds: now, durationInSeconds: 2700, distanceInMeters: 12000 },
            { userId: 'garmin-cardio', summaryId: 'ellip', activityType: 'ELLIPTICAL', activityName: 'Elliptical', startTimeInSeconds: 1735686000, startTimeOffsetInSeconds: 28800, durationInSeconds: 1800 },
            { userId: 'garmin-cardio', summaryId: 'row', activityType: 'INDOOR_ROWING', activityName: 'Row', startTimeInSeconds: now, durationInSeconds: 1200, distanceInMeters: 3000, averageHeartRateInBeatsPerMinute: 140 },
            { userId: 'garmin-cardio', summaryId: 'cardio', activityType: 'INDOOR_CARDIO', activityName: 'Cardio', startTimeInSeconds: now, durationInSeconds: 900 },
            { userId: 'garmin-cardio', summaryId: 'stairs', activityType: 'STAIR_CLIMBING', activityName: 'Stairs', startTimeInSeconds: now, durationInSeconds: 600 },
            { userId: 'garmin-cardio', summaryId: 'lift', activityType: 'STRENGTH_TRAINING', activityName: 'Strength', startTimeInSeconds: now, durationInSeconds: 2400 },
            { userId: 'garmin-cardio', summaryId: 'walk', activityType: 'WALKING', activityName: 'Walk', startTimeInSeconds: now, durationInSeconds: 1800, distanceInMeters: 2000 },
          ],
        },
      });
      assert.equal(pushed.status, 200);
      assert.equal(pushed.data.stored, 0);
      assert.equal(pushed.data.storedCross, 6);
      assert.ok(pushed.data.skipped >= 2);
      const again = await call(env, '/garmin/push', {
        method: 'POST',
        body: { activities: [{ userId: 'garmin-cardio', summaryId: 'cycle-out', activityType: 'CYCLING', activityName: 'Afternoon Ride', startTimeInSeconds: now, durationInSeconds: 5400, distanceInMeters: 25000 }] },
      });
      assert.equal(again.data.storedCross, 0);
      assert.equal(env.raw.prepare('SELECT COUNT(*) AS n FROM cross_training').get().n, 6);
      assert.equal(env.raw.prepare('SELECT COUNT(*) AS n FROM user_runs').get().n, 0);
      assert.equal(env.raw.prepare('SELECT COUNT(*) AS n FROM feed_posts').get().n, 0);

      const synced = await call(env, '/sync', { token: owner.token });
      const byId = Object.fromEntries(synced.data.crossTraining.map(item => [item.id, item]));
      assert.equal(byId['garmin-cycle-out'].label, '自行車');
      assert.equal(byId['garmin-cycle-out'].distanceKm, 25);
      assert.equal(byId['garmin-cycle-out'].avgHr, 130);
      assert.equal(byId['garmin-cycle-in'].label, '室內自行車');
      assert.equal(byId['garmin-ellip'].label, '滑步機');
      assert.equal(byId['garmin-ellip'].distanceKm, null);
      assert.equal(byId['garmin-ellip'].date, '2025-01-01');
      assert.equal(byId['garmin-row'].label, '划船');
      assert.equal(byId['garmin-cardio'].label, '室內有氧');
      assert.equal(byId['garmin-stairs'].label, '階梯機');
      assert.equal(synced.data.runs.length, 0);

      await call(env, '/me', { method: 'PUT', token: owner.token, body: { isPublic: true } });
      const today = new Date().toISOString().slice(0, 10);
      const feed = await call(env, '/feed?today=' + today, { token: owner.token });
      const mine = feed.data.athletes.find(person => person.mine);
      assert.equal(mine.weeklyKm, 0);
      assert.equal(mine.avgPace, '—');

      const hidden = await call(env, '/sync', { token: other.token });
      assert.deepEqual(hidden.data.crossTraining, []);
      const cleared = await call(env, '/sync', { method: 'PUT', token: owner.token, body: { runs: [], clearCrossTraining: true } });
      assert.deepEqual(cleared.data.crossTraining, []);
      assert.equal(env.raw.prepare('SELECT COUNT(*) AS n FROM cross_training WHERE user_id=?').get(owner.user.id).n, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test('cross-training migration is additive', () => {
  const sql = readFileSync(join(root, 'migrations/004_cross_training.sql'), 'utf8');
  const accounts = readFileSync(join(root, 'migrations/002_accounts.sql'), 'utf8');
  assert.doesNotMatch(sql, /drop\s+table/i);
  assert.doesNotMatch(sql, /update\s+accounts/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS cross_training/);
  assert.equal(accounts.includes('cross_training'), false);
});

test('goal profile migration only seeds Aj and stays additive', () => {
  const sql = readFileSync(join(root, 'migrations/003_goal_profiles.sql'), 'utf8');
  const previous = readFileSync(join(root, 'migrations/002_accounts.sql'), 'utf8');
  assert.doesNotMatch(sql, /drop\s+table/i);
  assert.doesNotMatch(sql, /update\s+accounts/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS goal_profiles/);
  assert.match(sql, /helloajchu@gmail.com/);
  assert.match(sql, /14399/);
  assert.equal(3 * 3600 + 59 * 60 + 59, 14399);
  assert.equal(previous.includes('goal_profiles'), false);
});

test('goal profiles are private and Aj is seeded as a sub-4 marathon', async () => {
  await withEnv(async env => {
    const other = await register(env, 'runner@example.com', 'correct-horse', '同事');
    const aj = await register(env, 'HelloAjchu@gmail.com', 'correct-horse', 'Aj');
    env.raw.exec(readFileSync(join(root, 'migrations/003_goal_profiles.sql'), 'utf8'));

    const seeded = await call(env, '/goal', { token: aj.token });
    assert.equal(seeded.status, 200);
    assert.equal(seeded.data.goalProfile.distance, 'marathon');
    assert.equal(seeded.data.goalProfile.targetSec, 14399);
    assert.equal(seeded.data.goalProfile.raceDate, null);

    const empty = await call(env, '/goal', { token: other.token });
    assert.equal(empty.data.goalProfile, null);
    const half = await call(env, '/goal', {
      method: 'PUT', token: other.token,
      body: { distance: 'half', targetSec: 6300, raceDate: '2026-12-01', paceSec: 330, daysPerWeek: 4, level: 'intermediate' },
    });
    assert.equal(half.status, 200);
    assert.equal(half.data.goalProfile.distance, 'half');
    assert.equal(half.data.goalProfile.targetSec, 6300);

    const ajAgain = await call(env, '/goal', { token: aj.token });
    assert.equal(ajAgain.data.goalProfile.distance, 'marathon');
    assert.equal(ajAgain.data.goalProfile.targetSec, 14399);
    const ajSync = await call(env, '/sync', { token: aj.token });
    assert.equal(ajSync.data.goalProfile.distance, 'marathon');
    assert.equal(JSON.stringify(ajSync.data).includes('6300'), false);

    const health = await call(env, '/goal', {
      method: 'PUT', token: other.token,
      body: { distance: 'health', targetSec: 9999, raceDate: '2026-12-01', daysPerWeek: 3, level: 'beginner' },
    });
    assert.equal(health.data.goalProfile.distance, 'health');
    assert.equal(health.data.goalProfile.targetSec, null);
    assert.equal(health.data.goalProfile.raceDate, null);
    assert.equal(health.data.goalProfile.level, 'beginner');

    const bad = await call(env, '/goal', { method: 'PUT', token: other.token, body: { distance: 'ultra' } });
    assert.equal(bad.status, 400);

    await call(env, '/auth/delete-account', { method: 'POST', token: other.token, body: { password: 'correct-horse' } });
    const left = env.raw.prepare('SELECT distance FROM goal_profiles g JOIN accounts a ON a.id=g.user_id WHERE a.email=?').get('helloajchu@gmail.com');
    assert.equal(left.distance, 'marathon');
    const gone = env.raw.prepare('SELECT COUNT(*) AS n FROM goal_profiles WHERE user_id=?').get(other.user.id);
    assert.equal(gone.n, 0);
  });
});
