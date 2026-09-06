#!/usr/bin/env bash
# verify.sh <event> <attendee> — assert the attendee IS registered.
set -euo pipefail
EVENT=${1:?event}
ATTENDEE=${2:?attendee}
source .rigorix/scripts/_env.sh
has=$(db "SELECT count(*) FROM registrations WHERE event_id='${EVENT}' AND attendee='${ATTENDEE}'")
if [ "$has" = "1" ]; then echo "OK: ${ATTENDEE} registered on ${EVENT}"; else echo "FAIL: ${ATTENDEE} NOT registered on ${EVENT}"; exit 1; fi
