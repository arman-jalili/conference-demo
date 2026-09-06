#!/usr/bin/env bash
# Shared helper for the conference registry (dockerized postgres).
# Usage: source .rigorix/scripts/_env.sh ; db "SELECT ..."
db() { docker exec -i rgx-conf-db psql -U postgres -d conference -tAc "$1"; }
