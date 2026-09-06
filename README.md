# conference-demo — Rigorix Governed Handoff (the Demo Operator conference-seat case)

A coding agent (Claude Code or Codex) works normally on a conference
registration service; **seat changes are executed by Rigorix** as bounded,
approved, auditable runbooks. This is the migration-demo pattern applied to
the conference-seat scenario, with the full control stack:

- **Prehook denial** — the agent tries `docker exec rgx-conf-db psql` and the
  PreToolUse hook refuses (same script for Claude Code and Codex)
- **Auth (ADR-008)** — RFC 8628 OIDC device flow against **Keycloak** in docker
- **Identity (ADR-012)** — attested claim summary from the device-flow login
- **Approval (ADR-011)** — consequence-bound, identity-bound approvals
- **Sequence-policy R2/R3** — remove-then-reassign denied in one plan; the
  legit transfer is policy-promoted to a human
- **R7 cross-run rules** — remove in run 1, add in run 2 → refused at plan
  time from the signed history
- **R5** — agents cannot edit `.rigorix/**` (operator-owned policy)
- **Signed envelopes** — HMAC-SHA256 trail in `.rigorix/audit` + POSTed to
  the enterprise dashboard

## Run the automated demo (scenes 0-12, all asserted)

```bash
docker compose up -d            # postgres (5434) + Keycloak (8080)
bash .rigorix/setup-db.sh       # conference registry baseline (conf-2026 FULL)
bash .rigorix/setup-keycloak.sh # realm rigorix + rigorix-demo client
RIGORIX_MCP_BIN=/path/to/rigorix-oss/target/debug/rigorix-mcp \
  node .rigorix/run-conference-demo.mjs
```

Scenes: 1 agent works normally (tests/tsc) · 2 agent's critical calls denied
by the prehook (try and fail) · 3 hand over to rigorix · 4 device-flow login ·
5 R5 policy-tamper denial · 6 composition deny · 7 promote pause · 8 identity-
bound approve · 9 signed evidence · 10 failure scene · 11 **R7 cross-run
denial (scene 9 real)** · 12 rollback.

## Run it live with an agent

Run `claude` or `codex` in this directory and ask:

> "demo@corp\.demo should get alice's seat at conf-2026 — alice is a no-show,
> dave from the waitlist is also interested. Let the usual controls apply."

Keycloak console: http://127.0.0.1:8080 (admin/admin). Demo users:
`demo` / `organizer` (password `<user>-pass-2026`). See ARTICLE.md for the
full narrative.
