#!/usr/bin/env bash
# record.sh <event> <attendee> — log the grant in the seat_ops ledger.
set -euo pipefail
EVENT=${1:?event}
ATTENDEE=${2:?attendee}
source .rigorix/scripts/_env.sh
db "INSERT INTO seat_ops (event_id, attendee, op) VALUES ('${EVENT}', '${ATTENDEE}', 'recorded')" >/dev/null
echo "recorded ${ATTENDEE} grant on ${EVENT}"
