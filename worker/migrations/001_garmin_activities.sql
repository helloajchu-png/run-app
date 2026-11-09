-- Run after the original schema.sql. garmin_oauth is already created.
-- wrangler d1 execute run-app --remote --file=worker/migrations/001_garmin_activities.sql

CREATE TABLE IF NOT EXISTS garmin_activities (
  id TEXT PRIMARY KEY,
  garmin_user_id TEXT NOT NULL,
  summary_id TEXT NOT NULL,
  activity_date TEXT NOT NULL,
  distance_km REAL NOT NULL,
  duration_sec INTEGER NOT NULL,
  avg_hr INTEGER,
  note TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (garmin_user_id, summary_id)
);
