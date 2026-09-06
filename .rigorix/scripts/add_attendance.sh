#!/usr/bin/env bash
# add_attendance.sh <event> <attendee> — register one attendee (capacity-gated).
set -euo pipefail
EVENT=${1:?event}
ATTENDEE=${2:?attendee}
source .rigorix/scripts/_env.sh
cap=$(db "SELECT capacity FROM events WHERE id='${EVENT}'")
cur=$(db "SELECT count(*) FROM registrations WHERE event_id='${EVENT}'")
if [ "$cur" -ge "$cap" ]; then
  echo "FAIL: ${EVENT} is full (${cur}/${cap}) — cannot register ${ATTENDEE}"
  exit 1
fi
db "INSERT INTO registrations (event_id, attendee) VALUES ('${EVENT}', '${ATTENDEE}') ON CONFLICT DO NOTHING" >/dev/null
ok=$(db "SELECT count(*) FROM registrations WHERE event_id='${EVENT}' AND attendee='${ATTENDEE}'")
if [ "$ok" != "1" ]; then echo "FAIL: could not register ${ATTENDEE}"; exit 1; fi
db "INSERT INTO seat_ops (event_id, attendee, op) VALUES ('${EVENT}', '${ATTENDEE}', 'add')" >/dev/null
echo "added ${ATTENDEE} to ${EVENT} (${cur}/$((cap)))"
