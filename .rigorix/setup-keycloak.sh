#!/usr/bin/env bash
# Idempotent Keycloak provisioning for the conference demo (REST).
# Creates: realm "rigorix", public client "rigorix-demo" with the OAuth 2.0
# Device Authorization Grant (RFC 8628), users demo + organizer.
#
# Notes (fixed 2026-09-06 after a live Claude Code session hit them):
#   - Keycloak 25 rejects the top-level "oauth2DeviceAuthorizationGrantEnabled"
#     field with HTTP 400 — the device grant is enabled via the client
#     *attributes* map ("oauth2.device.authorization.grant.enabled").
#   - Right after realm creation Keycloak can briefly 404 admin reads; with
#     `set -euo pipefail` that turned re-runs into a 409 race (exit 22).
#     Creates now tolerate 409 (already exists) and admin reads retry.
set -euo pipefail
BASE="http://127.0.0.1:8080"
REALM="rigorix"
CLIENT="rigorix-demo"

# Retry a curl until it succeeds (Keycloak settles after startup / realm
# creation). Fails the script after N tries.
curl_retry() {
  local n=0
  until curl -sf "$@"; do
    n=$((n + 1))
    [ "$n" -ge 10 ] && { echo "giving up after 10 tries: curl $*" >&2; return 22; }
    sleep 2
  done
}

# Wait for Keycloak
curl_retry -o /dev/null "$BASE/realms/master/.well-known/openid-configuration"

TOKEN=$(curl -sf -X POST "$BASE/realms/master/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=password" -d "client_id=admin-cli" \
  -d "username=admin" -d "password=admin" | python3 -c "import json,sys; print(json.load(sys.stdin)['access_token'])")

AUTH="Authorization: Bearer $TOKEN"
JSON="Content-Type: application/json"

# Realm (create tolerates 409 — already exists)
if curl_retry -o /dev/null "$BASE/admin/realms/$REALM" -H "$AUTH"; then
  echo "realm $REALM exists"
else
  code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/admin/realms" -H "$AUTH" -H "$JSON" \
    -d "{\"realm\":\"$REALM\",\"enabled\":true}")
  if [ "$code" = "409" ] || [ "$code" = "201" ] || [ "$code" = "200" ]; then
    echo "realm $REALM created"
  else
    echo "realm create failed: http=$code" >&2; exit 1
  fi
fi

# Client with the OAuth 2.0 Device Authorization Grant (RFC 8628) — the
# attribute form, not the top-level field Keycloak 25 rejects.
cid() {
  curl_retry "$BASE/admin/realms/$REALM/clients?clientId=$CLIENT" -H "$AUTH" \
    | python3 -c "import json,sys; a=json.load(sys.stdin); print(a[0]['id'] if a else '')"
}
CID=$(cid)
if [ -z "$CID" ]; then
  code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/admin/realms/$REALM/clients" -H "$AUTH" -H "$JSON" \
    -d "{\"clientId\":\"$CLIENT\",\"enabled\":true,\"publicClient\":true,\"standardFlowEnabled\":false,\"directAccessGrantsEnabled\":true,\"attributes\":{\"oauth2.device.authorization.grant.enabled\":\"true\"}}")
  if [ "$code" = "409" ] || [ "$code" = "201" ]; then
    echo "client $CLIENT created"
    CID=$(cid)
  else
    echo "client create failed: http=$code" >&2; exit 1
  fi
else
  echo "client $CLIENT exists"
fi

# Users (password '<user>-pass-2026', email verified so login skips
# VERIFY_PROFILE required actions)
for USER in demo organizer; do
  uid() {
    curl_retry "$BASE/admin/realms/$REALM/users?username=$USER" -H "$AUTH" \
      | python3 -c "import json,sys; a=json.load(sys.stdin); print(a[0]['id'] if a else '')"
  }
  UID_=$(uid)
  if [ -z "$UID_" ]; then
    code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/admin/realms/$REALM/users" -H "$AUTH" -H "$JSON" \
      -d "{\"username\":\"$USER\",\"enabled\":true,\"email\":\"$USER@corp.demo\",\"firstName\":\"$USER\",\"emailVerified\":true,\"requiredActions\":[]}")
    if [ "$code" != "201" ] && [ "$code" != "409" ]; then
      echo "user create failed: http=$code" >&2; exit 1
    fi
    UID_=$(uid)
    echo "user $USER created"
  fi
  curl_retry -X PUT "$BASE/admin/realms/$REALM/users/$UID_/reset-password" -H "$AUTH" \
    -H "$JSON" -d "{\"type\":\"password\",\"value\":\"$USER-pass-2026\",\"temporary\":false}"
done
echo "keycloak provisioned: realm=$REALM client=$CLIENT users=demo/organizer (password '<user>-pass-2026')"
echo "device endpoints:"
curl_retry "$BASE/realms/$REALM/.well-known/openid-configuration" | python3 -c "
import json,sys
d=json.load(sys.stdin)
print('  device_authorization_endpoint:', d.get('device_authorization_endpoint'))
print('  token_endpoint:', d.get('token_endpoint'))
"
