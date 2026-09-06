#!/usr/bin/env bash
# verify-absent.sh <event> <attendee> — assert the attendee is NOT registered.
set -euo pipefail
EVENT=${1:?event}
ATTENDEE=${2:?attendee}
source .rigorix/scripts/_env.sh
has=$(db "SELECT count(*) FROM registrations WHERE event_id='${EVENT}' AND attendee='${ATTENDEE}'")
if [ "$has" = "0" ]; then echo "OK: ${ATTENDEE} not registered on ${EVENT}"; else echo "FAIL: ${ATTENDEE} IS registered on ${EVENT}"; exit 1; fi
