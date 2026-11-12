-- Garmin cardio that is not a run. Kept out of user_runs so weekly km and pace stay running-only.
CREATE TABLE IF NOT EXISTS cross_training (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  garmin_user_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  summary_id TEXT NOT NULL,
  activity_date TEXT NOT NULL,
  sport TEXT NOT NULL,
  label TEXT NOT NULL,
  duration_sec INTEGER NOT NULL,
  distance_km REAL,
  avg_hr INTEGER,
  note TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (garmin_user_id, summary_id)
);
CREATE INDEX IF NOT EXISTS idx_cross_training_user_date ON cross_training(user_id, activity_date);
