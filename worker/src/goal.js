const DISTANCES = new Set(['5k', '10k', 'half', 'marathon', 'health']);
const LEVELS = new Set(['beginner', 'intermediate']);

function fail(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  throw err;
}

function optionalInt(value, min, max, label) {
  if (value == null || value === '') return null;
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n < min || n > max) fail(label);
  return n;
}

function optionalDate(value) {
  if (value == null || value === '') return null;
  const date = String(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail('比賽日期格式不對');
  return date;
}

export function publicGoal(row) {
  if (!row) return null;
  return {
    distance: row.distance,
    targetSec: row.target_sec == null ? null : Number(row.target_sec),
    raceDate: row.race_date || null,
    paceSec: row.pace_sec == null ? null : Number(row.pace_sec),
    daysPerWeek: Number(row.days_per_week),
    level: row.level,
  };
}

export async function getGoal(db, userId) {
  const row = await db.prepare(`SELECT distance, target_sec, race_date, pace_sec, days_per_week, level
    FROM goal_profiles WHERE user_id=?`).bind(userId).first();
  return publicGoal(row);
}

export async function putGoal(db, userId, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('目標格式不對');
  const distance = String(input.distance || '');
  if (!DISTANCES.has(distance)) fail('請選擇 5K、10K、半馬、全馬，或為了健康跑');
  const level = LEVELS.has(input.level) ? input.level : 'intermediate';
  const days = Math.round(Number(input.daysPerWeek));
  if (!(days >= 2 && days <= 6)) fail('每週跑步天數請選 2 到 6 天');
  const targetSec = distance === 'health' ? null : optionalInt(input.targetSec, 600, 36000, '目標時間不合理');
  const raceDate = distance === 'health' ? null : optionalDate(input.raceDate);
  const paceSec = optionalInt(input.paceSec, 150, 1200, '配速請填每公里 2:30 到 20:00');
  const now = new Date().toISOString();
  await db.prepare(`INSERT INTO goal_profiles (user_id, distance, target_sec, race_date, pace_sec, days_per_week, level, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      distance=excluded.distance,
      target_sec=excluded.target_sec,
      race_date=excluded.race_date,
      pace_sec=excluded.pace_sec,
      days_per_week=excluded.days_per_week,
      level=excluded.level,
      updated_at=excluded.updated_at`).bind(userId, distance, targetSec, raceDate, paceSec, days, level, now).run();
  return getGoal(db, userId);
}
