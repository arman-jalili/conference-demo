# conference-demo — Rigorix full-feature demo (the Demo Operator case)

A real, reproducible end-to-end demo of every Rigorix control, on the **unreleased local build**:

- **Auth (ADR-008)** — RFC 8628 OIDC device flow against **Keycloak** in docker
- **Identity (ADR-012)** — attested claim summary from the device-flow login
- **Approval (ADR-011)** — consequence-bound, identity-bound, single-use approvals
- **Sequence-policy R2/R3** — the remove-then-reassign composition is DENIED in one plan; the legit transfer is policy-promoted to a human
- **R7 cross-run rules** — remove in run 1, add in run 2 → the second run is refused **at plan time** from the signed history
- **R5** — agents cannot edit `.rigorix/**` (operator-owned policy)
- **Signed envelopes** — HMAC-SHA256 trail in `.rigorix/audit` + POSTed to the enterprise dashboard

## Run

```bash
docker compose up -d            # postgres (5434) + Keycloak (8080)
bash .rigorix/setup-db.sh       # conference registry baseline (conf-2026 FULL)
bash .rigorix/setup-keycloak.sh # realm rigorix + rigorix-demo client + demo/organizer
RIGORIX_MCP_BIN=/path/to/rigorix-oss/target/debug/rigorix-mcp \
  node .rigorix/run-conference-demo.mjs
```

Keycloak console: http://127.0.0.1:8080 (admin/admin). Demo users: `demo` / `organizer` (password `<user>-pass-2026`).
