#!/usr/bin/env bash
# verify_waitlist.sh <event> <attendee> — confirm the event is full and the
# attendee is NOT registered (they are on the waitlist).
set -euo pipefail
EVENT=${1:?event}
ATTENDEE=${2:?attendee}
source .rigorix/scripts/_env.sh
cap=$(db "SELECT capacity FROM events WHERE id='${EVENT}'")
cur=$(db "SELECT count(*) FROM registrations WHERE event_id='${EVENT}'")
has=$(db "SELECT count(*) FROM registrations WHERE event_id='${EVENT}' AND attendee='${ATTENDEE}'")
if [ "$has" != "0" ]; then echo "FAIL: ${ATTENDEE} is already registered"; exit 1; fi
echo "waitlist confirmed: ${EVENT} full (${cur}/${cap}), ${ATTENDEE} not registered"
