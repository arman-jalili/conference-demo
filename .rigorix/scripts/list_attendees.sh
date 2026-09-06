#!/usr/bin/env bash
# List registered attendees of conf-2026.
source .rigorix/scripts/_env.sh
db "SELECT attendee FROM registrations WHERE event_id='conf-2026' ORDER BY attendee"
