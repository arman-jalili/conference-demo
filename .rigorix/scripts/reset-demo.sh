#!/usr/bin/env bash
# reset-demo.sh — reset the conference demo to a pristine state for a new run.
#
# Idempotent and safe to run between sessions. Returns the registry to the
# Session-A/B baseline (conf-2026 FULL: alice + ghost + 98 fillers), clears
# the signed-audit trail + approval/run/session state, and (re)provisions
# Keycloak so a fresh device-flow login works.
#
# Why clearing the audit trail matters: sequence-policy R7 reads the signed
# prior-execution history (.rigorix/audit). A stale remove envelope from a
# previous session within the 15-minute window would make the next demo's
# first seat change look like "run 2" of an earlier pair.
set -euo pipefail
cd "$(dirname "$0")/../.." # repo root (script lives in .rigorix/scripts/)

echo "── 1/5 docker compose up (postgres rgx-conf-db + Keycloak rgx-conf-idp)"
docker compose up -d

echo "── 2/5 registry reset (setup-db.sh reseeds conf-2026 at 100/100)"
bash .rigorix/scripts/setup-db.sh

echo "── 3/5 clear Rigorix runtime state (audit envelopes, approvals, sessions, run state)"
rm -f .rigorix/approvals.json 2>/dev/null || true
find .rigorix/audit .rigorix/state .rigorix/tmp -type f -delete 2>/dev/null || true

echo "── 4/5 Keycloak provisioning (idempotent; demo + organizer device flow)"
bash .rigorix/setup-keycloak.sh >/dev/null

echo "── 5/5 git identity (signed runs carry the demo principal)"
git config user.email demo@corp.demo
git config user.name "Demo Operator"

echo "✅ demo reset — conf-2026 FULL (alice + ghost + 98 fillers), trail cleared, Keycloak ready."
