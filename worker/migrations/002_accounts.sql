-- Account login, per-user training sync, public feed, and Garmin ownership.
-- Additive only: legacy nickname/PIN tables (users, sessions, friends, posts, likes)
-- and existing Garmin rows are left in place.

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_iterations INTEGER NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  is_public INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);

CREATE TABLE IF NOT EXISTS user_runs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  run_date TEXT NOT NULL,
  distance_km REAL NOT NULL,
  duration_sec INTEGER NOT NULL,
  avg_hr INTEGER,
  note TEXT,
  source TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, client_id)
);
CREATE INDEX IF NOT EXISTS idx_user_runs_user_date ON user_runs(user_id, run_date);

CREATE TABLE IF NOT EXISTS user_settings (
  user_id TEXT PRIMARY KEY,
  race_json TEXT,
  goal_json TEXT,
  checks_json TEXT,
  coach_url TEXT,
  plan_blurb TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_limits (
  bucket TEXT PRIMARY KEY,
  hits INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS feed_posts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  body TEXT NOT NULL,
  km REAL,
  pace TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_feed_posts_created ON feed_posts(created_at);

CREATE TABLE IF NOT EXISTS feed_likes (
  post_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (post_id, user_id)
);

ALTER TABLE garmin_oauth ADD COLUMN user_id TEXT;
CREATE INDEX IF NOT EXISTS idx_garmin_oauth_user ON garmin_oauth(user_id);
CREATE INDEX IF NOT EXISTS idx_garmin_oauth_garmin_user ON garmin_oauth(garmin_user_id);
CREATE INDEX IF NOT EXISTS idx_accounts_public ON accounts(is_public);
