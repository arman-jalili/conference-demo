# conference-demo — governed handoff (Codex)

This repo demonstrates Rigorix Governed Handoff on the exact scenario from
the conference-seat post: a coding agent does normal development freely, but
**seat changes in the conference registry are executed by Rigorix as
bounded, approved, auditable runbooks** — never by the agent directly.

Read `CLAUDE.md` for the full demo narrative; the runbook and enforcement
boundary it describes apply unchanged to Codex.

## What the agent may do freely

- Edit TypeScript source (`src/`), add methods, write tests, run `npm test`,
  run `npx tsc --noEmit`, run `docker compose up` (start the stack).

## What the agent MUST hand off to Rigorix

Seat changes (add / remove / transfer / restore in the registry) are
critical. A PreToolUse hook in `.codex/config.toml` (the same
`deny-seat-mutation.mjs` script Claude Code uses) blocks **direct DB-tool
invocation, period** — psql / pg_dump / pg_restore / mysql / sqlite3 /
docker exec against `rgx-conf-db`, whether the command reads or writes, plus
**any `.rigorix/**` write**. Read-only inspection IS allowed via the
sanctioned scripts (`.rigorix/scripts/verify*.sh` — the hook scans them and
lets read-only queries through; write-intent SQL is denied).

When a task requires a seat change, use the Rigorix MCP tools instead:

1. `rigorix_run` with `template_name` matching the intent:
   - `waitlist-transfer` — genuine no-show transfer (policy-promoted:
     pauses for human approval).
   - `attendance-remove` / `attendance-add` — direct seat mutations
     (remove-then-reassign in one plan is DENIED by sequence policy).
   - `restore-seat` — roll back a change that should not have happened.
2. When it reports `PendingApproval`, ask the human to approve via
   `rigorix_approve_execution` (`execution_id` + pending step name).
3. After resume, confirm the run completed and the registry changed.
4. Every run produces a signed audit envelope (`.rigorix/audit`) and is
   POSTed to the enterprise dashboard.
