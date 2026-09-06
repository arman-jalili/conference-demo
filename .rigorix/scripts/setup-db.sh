#!/usr/bin/env bash
# Reset the conference registry to the demo baseline:
# event conf-2026 with capacity 100 — FULL (alice, ghost, 98 fillers).
set -euo pipefail
docker exec -i rgx-conf-db psql -U postgres -d conference -v ON_ERROR_STOP=1 -q <<'SQL'
DROP TABLE IF EXISTS seat_ops;
DROP TABLE IF EXISTS registrations;
DROP TABLE IF EXISTS events;
CREATE TABLE events (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  capacity INT NOT NULL
);
CREATE TABLE registrations (
  event_id TEXT NOT NULL REFERENCES events(id),
  attendee TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'registered',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, attendee)
);
CREATE TABLE seat_ops (
  id BIGSERIAL PRIMARY KEY,
  event_id TEXT NOT NULL,
  attendee TEXT NOT NULL,
  op TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO events (id, name, capacity) VALUES ('conf-2026', 'Conf 2026', 100);
INSERT INTO registrations (event_id, attendee) VALUES
  ('conf-2026', 'alice'),
  ('conf-2026', 'ghost');
INSERT INTO registrations (event_id, attendee)
  SELECT 'conf-2026', 'attendee_' || lpad(i::text, 3, '0') FROM generate_series(1, 98) i;
SQL
n=$(docker exec rgx-conf-db psql -U postgres -d conference -tAc "SELECT count(*) FROM registrations WHERE event_id='conf-2026'")
echo "conference baseline: conf-2026 capacity=100 registrations=$n"
