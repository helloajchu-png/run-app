function fail(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  throw err;
}

function parseJson(value, fallback) {
  if (value == null || value === '') return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

export function dedupeKey(run) {
  return `${run.date}|${Math.round(Number(run.distanceKm) * 20)}`;
}

export function normalizeRun(input) {
  if (!input || typeof input !== 'object') return null;
  const id = String(input.id || '').trim();
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) return null;
  const date = String(input.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const distanceKm = Math.round(Number(input.distanceKm) * 1000) / 1000;
  const durationSec = Math.round(Number(input.durationSec));
  if (!(distanceKm > 0 && distanceKm < 1000)) return null;
  if (!(durationSec > 0 && durationSec < 172800)) return null;
  let avgHr = input.avgHr == null || input.avgHr === '' ? null : Math.round(Number(input.avgHr));
  if (avgHr != null && !(avgHr >= 30 && avgHr <= 240)) avgHr = null;
  const note = String(input.note || '').slice(0, 200);
  const source = String(input.source || 'manual').replace(/[^\w.-]/g, '').slice(0, 32) || 'manual';
  return { id, date, distanceKm, durationSec, avgHr, note, source };
}

function cleanRace(value) {
  if (value == null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) fail('比賽成績格式不對');
  const dist = Number(value.dist);
  const sec = Math.round(Number(value.sec));
  if (!(dist > 0 && dist <= 1000) || !(sec > 0 && sec < 200000)) fail('比賽成績格式不對');
  const date = typeof value.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.date) ? value.date : '';
  return { dist, sec, date };
}

function cleanGoal(value) {
  if (value == null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) fail('目標格式不對');
  const dist = Number(value.dist);
  const sec = Math.round(Number(value.sec));
  const days = String(value.days ?? '');
  const date = String(value.date || '');
  if (!(dist > 0 && dist <= 1000) || !(sec > 0 && sec < 200000)) fail('目標格式不對');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^[1-7]$/.test(days)) fail('目標格式不對');
  return { dist, date, sec, days };
}

function cleanChecks(value) {
  if (value == null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) fail('課表勾選格式不對');
  const out = {};
  for (const [key, on] of Object.entries(value)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !on) continue;
    out[key] = 1;
    if (Object.keys(out).length >= 400) break;
  }
  return out;
}

function cleanUrl(value) {
  if (value == null || value === '') return '';
  const url = String(value).trim();
  if (!url) return '';
  if (url.length > 300 || !/^https:\/\/\S+$/i.test(url)) fail('教練網址需要是 https');
  return url.replace(/\/+$/, '');
}

function cleanBlurb(value) {
  return String(value || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 280);
}

export function validateSettings(input) {
  const out = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out;
  if ('race' in input) out.race = cleanRace(input.race);
  if ('goal' in input) out.goal = cleanGoal(input.goal);
  if ('checks' in input) out.checks = cleanChecks(input.checks);
  if ('coachUrl' in input) out.coachUrl = cleanUrl(input.coachUrl);
  if ('planBlurb' in input) out.planBlurb = cleanBlurb(input.planBlurb);
  return out;
}

export async function listRuns(db, userId) {
  const rows = await db.prepare(`SELECT client_id, run_date, distance_km, duration_sec, avg_hr, note, source
    FROM user_runs WHERE user_id=? ORDER BY run_date DESC, client_id`).bind(userId).all();
  return (rows.results || []).map(row => ({
    id: row.client_id,
    date: row.run_date,
    distanceKm: Number(row.distance_km),
    durationSec: Number(row.duration_sec),
    avgHr: row.avg_hr == null ? null : Number(row.avg_hr),
    note: row.note || '',
    source: row.source || 'manual',
  }));
}

export async function getSettings(db, userId) {
  const row = await db.prepare('SELECT race_json, goal_json, checks_json, coach_url, plan_blurb FROM user_settings WHERE user_id=?').bind(userId).first();
  if (!row) return { race: null, goal: null, checks: {}, coachUrl: '', planBlurb: '' };
  return {
    race: parseJson(row.race_json, null),
    goal: parseJson(row.goal_json, null),
    checks: parseJson(row.checks_json, {}) || {},
    coachUrl: row.coach_url || '',
    planBlurb: row.plan_blurb || '',
  };
}

function emptySetting(current, key) {
  if (key === 'checks') return !current.checks || !Object.keys(current.checks).length;
  if (key === 'coachUrl' || key === 'planBlurb') return !current[key];
  return current[key] == null;
}

async function writeSettings(db, userId, next) {
  await db.prepare(`INSERT INTO user_settings (user_id, race_json, goal_json, checks_json, coach_url, plan_blurb, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      race_json=excluded.race_json,
      goal_json=excluded.goal_json,
      checks_json=excluded.checks_json,
      coach_url=excluded.coach_url,
      plan_blurb=excluded.plan_blurb,
      updated_at=excluded.updated_at`).bind(
    userId,
    JSON.stringify(next.race ?? null),
    JSON.stringify(next.goal ?? null),
    JSON.stringify(next.checks || {}),
    next.coachUrl || '',
    next.planBlurb || '',
    new Date().toISOString()
  ).run();
}

export async function putSettings(db, userId, input, mode) {
  const clean = validateSettings(input);
  const current = await getSettings(db, userId);
  const next = { ...current };
  for (const key of ['race', 'goal', 'checks', 'coachUrl', 'planBlurb']) {
    if (!(key in clean)) continue;
    if (mode === 'merge') {
      if (emptySetting(current, key) && clean[key] && (key !== 'checks' || Object.keys(clean[key]).length)) next[key] = clean[key];
      continue;
    }
    next[key] = clean[key];
  }
  await writeSettings(db, userId, next);
  return next;
}

export async function upsertRuns(db, userId, incoming, { mode = 'replace', deletedIds = [] } = {}) {
  const existing = await listRuns(db, userId);
  const byId = new Map(existing.map(run => [run.id, run]));
  const keys = new Map(existing.map(run => [dedupeKey(run), run.id]));
  let added = 0;
  let updated = 0;
  let skipped = 0;
  const now = new Date().toISOString();
  for (const raw of incoming) {
    const run = normalizeRun(raw);
    if (!run) { skipped++; continue; }
    const key = dedupeKey(run);
    const sameId = byId.get(run.id);
    const keyOwner = keys.get(key);
    if (sameId) {
      if (keyOwner && keyOwner !== run.id) { skipped++; continue; }
      await db.prepare(`UPDATE user_runs SET run_date=?, distance_km=?, duration_sec=?, avg_hr=?, note=?, source=?, updated_at=?
        WHERE user_id=? AND client_id=?`).bind(run.date, run.distanceKm, run.durationSec, run.avgHr, run.note, run.source, now, userId, run.id).run();
      keys.delete(dedupeKey(sameId));
      keys.set(key, run.id);
      byId.set(run.id, run);
      updated++;
      continue;
    }
    if (keyOwner) { skipped++; continue; }
    await db.prepare(`INSERT INTO user_runs (id, user_id, client_id, run_date, distance_km, duration_sec, avg_hr, note, source, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
      crypto.randomUUID(), userId, run.id, run.date, run.distanceKm, run.durationSec, run.avgHr, run.note, run.source, now
    ).run();
    byId.set(run.id, run);
    keys.set(key, run.id);
    added++;
  }
  let deleted = 0;
  if (mode !== 'merge' && Array.isArray(deletedIds)) {
    for (const id of deletedIds) {
      if (typeof id !== 'string' || !byId.has(id)) continue;
      const result = await db.prepare('DELETE FROM user_runs WHERE user_id=? AND client_id=?').bind(userId, id).run();
      if (result && result.meta && result.meta.changes) deleted++;
      byId.delete(id);
    }
  }
  return { added, updated, skipped, deleted };
}

export async function putSync(db, userId, body) {
  const mode = body && body.mode === 'merge' ? 'merge' : 'replace';
  const incoming = Array.isArray(body && body.runs) ? body.runs : [];
  if (incoming.length > 2000) fail('一次最多同步 2000 筆');
  const counts = await upsertRuns(db, userId, incoming, { mode, deletedIds: body && body.deletedIds });
  if (body && body.settings && typeof body.settings === 'object' && !Array.isArray(body.settings)) {
    await putSettings(db, userId, body.settings, mode);
  }
  return { ok: true, ...counts, runs: await listRuns(db, userId), settings: await getSettings(db, userId) };
}

export async function mirrorGarminRun(db, userId, run) {
  const id = ('garmin-' + String(run.summaryId || '')).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80);
  if (id.length < 8) return { added: 0, updated: 0, skipped: 1, deleted: 0 };
  return upsertRuns(db, userId, [{
    id,
    date: run.date,
    distanceKm: run.distanceKm,
    durationSec: run.durationSec,
    avgHr: run.avgHr,
    note: run.note || '',
    source: 'garmin',
  }], { mode: 'merge', deletedIds: [] });
}
