#!/usr/bin/env bash
# restore.sh <event> <attendee> — restore a registration (rollback scene).
set -euo pipefail
EVENT=${1:?event}
ATTENDEE=${2:?attendee}
source .rigorix/scripts/_env.sh
db "INSERT INTO registrations (event_id, attendee) VALUES ('${EVENT}', '${ATTENDEE}') ON CONFLICT (event_id, attendee) DO UPDATE SET status='restored'" >/dev/null
db "INSERT INTO seat_ops (event_id, attendee, op) VALUES ('${EVENT}', '${ATTENDEE}', 'restore')" >/dev/null
echo "restored ${ATTENDEE} on ${EVENT}"
