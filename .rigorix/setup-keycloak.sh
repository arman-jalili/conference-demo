#!/usr/bin/env bash
# Idempotent Keycloak provisioning for the conference demo (REST).
# Creates: realm "rigorix", public client "rigorix-demo" with the OAuth 2.0
# Device Authorization Grant (RFC 8628), users demo + organizer.
set -euo pipefail
BASE="http://127.0.0.1:8080"
REALM="rigorix"
CLIENT="rigorix-demo"

# Wait for Keycloak
for i in $(seq 1 60); do
  curl -sf -o /dev/null "$BASE/realms/master/.well-known/openid-configuration" && break
  echo "waiting for keycloak ($i)…"; sleep 3
done

TOKEN=$(curl -sf -X POST "$BASE/realms/master/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=password" -d "client_id=admin-cli" \
  -d "username=admin" -d "password=admin" | python3 -c "import json,sys; print(json.load(sys.stdin)['access_token'])")

AUTH="Authorization: Bearer $TOKEN"

# Realm
if ! curl -sf -o /dev/null "$BASE/admin/realms/$REALM"; then
  curl -sf -X POST "$BASE/admin/realms" -H "$AUTH" -H "Content-Type: application/json" \
    -d "{\"realm\":\"$REALM\",\"enabled\":true}"
  echo "realm $REALM created"
else
  echo "realm $REALM exists"
fi

# Client with device authorization grant
CID=$(curl -sf "$BASE/admin/realms/$REALM/clients?clientId=$CLIENT" -H "$AUTH" | python3 -c "import json,sys; a=json.load(sys.stdin); print(a[0]['id'] if a else '')")
if [ -z "$CID" ]; then
  curl -sf -X POST "$BASE/admin/realms/$REALM/clients" -H "$AUTH" -H "Content-Type: application/json" \
    -d "{\"clientId\":\"$CLIENT\",\"enabled\":true,\"publicClient\":true,\"standardFlowEnabled\":false,\"directAccessGrantsEnabled\":true,\"oauth2DeviceAuthorizationGrantEnabled\":true}"
  echo "client $CLIENT created"
else
  echo "client $CLIENT exists"
fi

# Users
for USER in demo organizer; do
  UID_=$(curl -sf "$BASE/admin/realms/$REALM/users?username=$USER" -H "$AUTH" | python3 -c "import json,sys; a=json.load(sys.stdin); print(a[0]['id'] if a else '')")
  if [ -z "$UID_" ]; then
    UID_=$(curl -sf -X POST "$BASE/admin/realms/$REALM/users" -H "$AUTH" -H "Content-Type: application/json" \
      -d "{\"username\":\"$USER\",\"enabled\":true,\"email\":\"$USER@corp.demo\",\"firstName\":\"$USER\",\"emailVerified\":true}" \
      -w "\n%{header} " 2>/dev/null | tail -1 | tr -d '\r' || true)
    # simpler: re-query
    UID_=$(curl -sf "$BASE/admin/realms/$REALM/users?username=$USER" -H "$AUTH" | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['id'])")
    echo "user $USER created"
  fi
  curl -sf -X PUT "$BASE/admin/realms/$REALM/users/$UID_/reset-password" -H "$AUTH" \
    -H "Content-Type: application/json" -d "{\"type\":\"password\",\"value\":\"$USER-pass-2026\",\"temporary\":false}"
done
echo "keycloak provisioned: realm=$REALM client=$CLIENT users=demo/organizer (password '<user>-pass-2026')"
echo "device endpoints:"
curl -sf "$BASE/realms/$REALM/.well-known/openid-configuration" | python3 -c "
import json,sys
d=json.load(sys.stdin)
print(' issuer:', d['issuer'])
print(' device_authorization_endpoint:', d.get('device_authorization_endpoint'))
print(' token_endpoint:', d.get('token_endpoint'))
"
