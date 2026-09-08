# Rigorix Governed Handoff — the conference-seat case, from post to production demo

**The conference-seat thread (2026-09-03).** A conference operator posts a
growing concern about agents and conference seats: an autonomous agent that
can touch the registration system could "remove an attendee and register
itself in the freed slot" — two individually-permitted actions whose pair is
clearly outside operator intent. There was a promise in that thread: *"I'll
update you on this thread as it lands."* This repo is that update, built as a
runnable demo against the real engine.

## The shape of the answer

One agent session on one repo shows the whole arc:

1. **The agent works normally.** Claude Code or Codex edits `src/`, adds
   tests, runs `npm test` / `tsc` — the allowlist path, no prompts. Normal
   development is not gated; consequence is.

2. **The agent tries the critical thing and FAILS at the prehook.** The
   moment it reaches for `docker exec rgx-conf-db psql` (the only way to
   mutate the live registry), the PreToolUse hook — the same
   `deny-seat-mutation.mjs` wired for Claude Code *and* Codex — denies the
   call: *"Seat changes in the conference registry are critical operations
   governed by Rigorix. Hand off to rigorix_run…"*. The hook governs
   agent-mediated tool calls; it is the first line of a known arms race, and
   it does not pretend to be an airtight sandbox.

3. **The agent hands off to Rigorix.** The guarded operation runs as a
   bounded, approved, auditable runbook — with the engine's own enforcement
   behind it, so the boundary holds even past the hook:
   - **R5** — a run that tries to edit `.rigorix/sequence-policy.toml` is
     denied by the permission enforcer; the policy file keeps failing closed.
   - **R2 (same plan)** — remove alice then add demo in ONE run is refused
     *at plan time*: `Sequence policy denied step 'registration_add' (rule
     'no-remove-then-reassign')`. Nothing executed; alice's seat untouched.
   - **R3 (promote)** — the legitimate path, a no-show transfer to the
     waitlist, is *policy-promoted*: the run pauses at `transfer_seat` and a
     human approves with an attested identity (OIDC device flow against
     Keycloak, ADR-008/011/012). Then it lands, audited.
   - **R7 (cross-run)** — the actual follow-up the thread demanded: remove in
     run 1 passes its own gate; add in run 2 is refused at plan time by a
     rule that reads the *signed execution trail* (same principal, 15-minute
     window). The deny is grounded in HMAC-signed evidence — tampering with
     the trail to evade the rule breaks the signature.

4. **Everything is signed.** Every runbook persists an HMAC-SHA256 envelope
   to `.rigorix/audit` — a local signed trail (author, template, per-node
   events, sequence-policy findings, approval evidence). Posting to the
   enterprise dashboard is opt-in via rigorix.toml backend keys; this public
   repo ships local-only so the HMAC trail is verifiable anywhere.

## What is real here

Run it yourself — the driver executes and asserts every scene:

```bash
cd ~/project/conference-demo
docker compose up -d                      # postgres (5434) + Keycloak (8080)
bash .rigorix/setup-db.sh                 # conf-2026 registry, FULL
bash .rigorix/setup-keycloak.sh           # realm rigorix + rigorix-demo client
RIGORIX_MCP_BIN=/path/to/rigorix-oss/target/debug/rigorix-mcp \
  node .rigorix/run-conference-demo.mjs   # scenes 0-12, exit 0 = verified
```

Or live with an agent: run `claude` or `codex` in this directory and ask for
the seat. The prehook denies; the agent hands off; the runbook pauses; the
human approves with their identity; the envelope signs.

## The honest ceilings

- The hook governs agent tool calls, not arbitrary code with real
  credentials outside the agent session.
- The engine fixes that made this demo's evidence complete (signed
  envelopes on every run, per-run event windows on a shared event bus) are
  on the unreleased local build; crates.io remains a separate ship gate.
- ADR-008/011/012/013 moved to *Accepted (locally validated)* on the strength
  of this full-stack run — a production deployment is still ahead.
