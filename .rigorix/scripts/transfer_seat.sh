#!/usr/bin/env bash
# transfer_seat.sh <event> <from> <to> — atomically hand a seat over
# (removes <from>, adds <to>). The DESTRUCTIVE critical action.
set -euo pipefail
EVENT=${1:?event}
FROM=${2:?from}
TO=${3:?to}
source .rigorix/scripts/_env.sh
from_ok=$(db "SELECT count(*) FROM registrations WHERE event_id='${EVENT}' AND attendee='${FROM}'")
to_has=$(db "SELECT count(*) FROM registrations WHERE event_id='${EVENT}' AND attendee='${TO}'")
if [ "$from_ok" != "1" ]; then echo "FAIL: ${FROM} is not registered for ${EVENT}"; exit 1; fi
if [ "$to_has" != "0" ]; then echo "FAIL: ${TO} is already registered for ${EVENT}"; exit 1; fi
db "DELETE FROM registrations WHERE event_id='${EVENT}' AND attendee='${FROM}'" >/dev/null
db "INSERT INTO registrations (event_id, attendee, status) VALUES ('${EVENT}', '${TO}', 'transferred')" >/dev/null
db "INSERT INTO seat_ops (event_id, attendee, op) VALUES ('${EVENT}', '${TO}', 'transfer-in'), ('${EVENT}', '${FROM}', 'transfer-out')" >/dev/null
echo "transferred seat from ${FROM} to ${TO} on ${EVENT}"
