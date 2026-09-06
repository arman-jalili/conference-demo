#!/usr/bin/env bash
# remove_attendance.sh <event> <attendee> — cancel one registration.
set -euo pipefail
EVENT=${1:?event}
ATTENDEE=${2:?attendee}
source .rigorix/scripts/_env.sh
rows=$(db "DELETE FROM registrations WHERE event_id='${EVENT}' AND attendee='${ATTENDEE}' RETURNING attendee")
if [ -z "$rows" ]; then echo "FAIL: ${ATTENDEE} is not registered for ${EVENT}"; exit 1; fi
db "INSERT INTO seat_ops (event_id, attendee, op) VALUES ('${EVENT}', '${ATTENDEE}', 'remove')" >/dev/null
echo "removed ${ATTENDEE} from ${EVENT}"
