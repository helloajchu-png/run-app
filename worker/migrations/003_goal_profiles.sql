-- Per-user race goal. Additive only. Do not edit older migrations.
-- Apply by hand:
--   npx wrangler d1 execute run-app --remote --file=migrations/003_goal_profiles.sql

CREATE TABLE IF NOT EXISTS goal_profiles (
  user_id TEXT PRIMARY KEY,
  distance TEXT NOT NULL,
  target_sec INTEGER,
  race_date TEXT,
  pace_sec INTEGER,
  days_per_week INTEGER NOT NULL DEFAULT 4,
  level TEXT NOT NULL DEFAULT 'intermediate',
  updated_at TEXT NOT NULL
);

-- Aj keeps a full marathon at 3:59:59 (14399 seconds). Lookup is by email only.
INSERT INTO goal_profiles (user_id, distance, target_sec, race_date, pace_sec, days_per_week, level, updated_at)
SELECT a.id, 'marathon', 14399, NULL, NULL, 5, 'intermediate', '2026-11-11T00:00:00.000Z'
FROM accounts a
WHERE a.email = 'helloajchu@gmail.com'
  AND NOT EXISTS (SELECT 1 FROM goal_profiles g WHERE g.user_id = a.id);
