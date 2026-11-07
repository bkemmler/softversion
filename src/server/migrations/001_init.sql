-- Grundschema laut docs/konzept.md, Abschnitt Datenmodell. Zeiten als ISO-8601-Text (UTC).
CREATE TABLE products (
  id INTEGER PRIMARY KEY,
  tracker_id TEXT NOT NULL UNIQUE,
  vendor TEXT NOT NULL,
  product TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  auto_enable_new_lines INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'new',          -- new | ok | error | missing
  baselined INTEGER NOT NULL DEFAULT 0,        -- 1 nach dem ersten erfolgreichen Lauf
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  failure_alerted INTEGER NOT NULL DEFAULT 0,
  last_check_at TEXT,
  last_error TEXT
);

CREATE TABLE version_lines (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  line_key TEXT NOT NULL,
  enabled INTEGER NOT NULL,
  first_seen_at TEXT NOT NULL,
  UNIQUE (product_id, line_key)
);

CREATE TABLE releases (
  id INTEGER PRIMARY KEY,
  line_id INTEGER NOT NULL REFERENCES version_lines(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  type TEXT NOT NULL,                          -- major | servicepack | hotfix | patch
  release_date TEXT,
  notes_url TEXT,
  download_url TEXT,
  sort_key TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  fingerprint TEXT NOT NULL UNIQUE             -- line_id + version
);
CREATE INDEX releases_line ON releases(line_id, sort_key);
CREATE INDEX releases_seen ON releases(first_seen_at);

CREATE TABLE check_runs (
  id INTEGER PRIMARY KEY,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  trigger TEXT NOT NULL,                       -- schedule | manual | cli
  status TEXT NOT NULL                         -- running | ok | partial | error | aborted
);

CREATE TABLE check_results (
  id INTEGER PRIMARY KEY,
  run_id INTEGER NOT NULL REFERENCES check_runs(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  status TEXT NOT NULL,                        -- ok | error
  error TEXT,
  duration_ms INTEGER NOT NULL,
  found_count INTEGER NOT NULL DEFAULT 0,
  new_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX check_results_run ON check_results(run_id);

CREATE TABLE channels (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'teams_workflow',
  webhook_url TEXT NOT NULL,                   -- AES-256-GCM verschlüsselt
  enabled INTEGER NOT NULL DEFAULT 0,          -- erst nach erfolgreicher Testnachricht aktiv
  last_error TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE notifications (
  id INTEGER PRIMARY KEY,
  release_id INTEGER REFERENCES releases(id) ON DELETE CASCADE,  -- NULL bei Ausfall-Warnungen
  channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  payload TEXT,                                -- Text der Ausfall-Warnung
  status TEXT NOT NULL DEFAULT 'pending',      -- pending | sent | failed
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL,
  sent_at TEXT
);
CREATE INDEX notifications_status ON notifications(status);

CREATE TABLE credentials (
  tracker_id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  secret TEXT NOT NULL,                        -- AES-256-GCM verschlüsselt
  updated_at TEXT NOT NULL
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT INTO settings (key, value) VALUES
  ('schedule_time', '06:00'),
  ('timezone', 'Europe/Berlin'),
  ('failure_alert_threshold', '3');
