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
            },
          ],
        },
      });
      assert.equal(pushed.status, 200);
      assert.equal(pushed.data.stored, 1);
      assert.ok(pushed.data.skipped >= 1);

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

      const synced = await call(env, '/sync', { token: phone.data.token });
      assert.equal(synced.data.runs.length, 1);
      assert.equal(synced.data.runs[0].source, 'garmin');
      assert.equal(synced.data.runs[0].note, 'Morning Run');

      const strangerStatus = await call(env, '/garmin/status', { method: 'POST', token: other.token, body: {} });
      assert.equal(strangerStatus.data.connected, false);
      const strangerInbox = await call(env, '/garmin/inbox', { method: 'POST', token: other.token, body: {} });
      assert.deepEqual(strangerInbox.data.runs, []);
      const strangerSync = await call(env, '/sync', { token: other.token });
      assert.deepEqual(strangerSync.data.runs, []);
      assert.equal(JSON.stringify(strangerSync.data).includes('Morning Run'), false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
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
