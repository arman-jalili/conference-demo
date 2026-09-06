#!/usr/bin/env bash
# Print the conf-2026 capacity + current registration count.
source .rigorix/scripts/_env.sh
cap=$(db "SELECT capacity FROM events WHERE id='conf-2026'")
cur=$(db "SELECT count(*) FROM registrations WHERE event_id='conf-2026'")
echo "conf-2026: ${cur}/${cap} seats taken"
