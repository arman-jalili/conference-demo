// deny-seat-mutation.mjs — PreToolUse hook ("the stick"), shared by Claude
// Code (.claude/settings.json) and Codex (.codex/config.toml).
//
// SCOPE (documented boundary — read this before relying on the hook):
//   This hook governs AGENT-MEDIATED tool calls in Claude Code / Codex: it
//   blocks DIRECT DB-TOOL INVOCATION (psql / pg_dump / pg_restore / mysql /
//   sqlite3 / docker exec against the conference DB, rgx-conf-db) — read OR
//   write. That is deliberate: parsing a `psql -c` string to tell a read
//   from a write is fragile (chained statements, `psql -f` files), so the
//   boundary is "no direct DB tools — use Rigorix", not "no direct DB
//   writes". Read-only inspection IS allowed via the sanctioned scripts
//   (.rigorix/scripts/verify*.sh — the hook scans them; read-only queries
//   pass, write-intent SQL is denied). It does NOT govern arbitrary code
//   execution with real credentials outside the agent session (a shell a
//   human already controls, a CI runner, a background process). That is a
//   sandbox/secrets boundary, not a hook boundary. The demo's guarantee is:
//   an agent cannot silently mutate the conference registry from a Claude
//   Code or Codex tool call; if it needs a seat change, it must hand off to
//   Rigorix (rigorix_run).
//
//   This is the first line of a known arms race (Shield changelog dynamic):
//   a smarter agent could write a script that hides its intent. We scan the
//   obvious surfaces; we do not claim an airtight sandbox. Say that plainly
//   to customers — "governs agent tool calls, not arbitrary code with
//   credentials" — rather than implying more coverage than exists.
//
// stdin:  { tool_name, tool_input, ... }
// stdout: { hookSpecificOutput: { hookEventName, permissionDecision, permissionDecisionReason } }
// exit code 2 = block the tool call.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const input = JSON.parse(readFileSync(0, "utf8"));
const tool = input.tool_name ?? "";
const cmd = String(input.tool_input?.command ?? input.tool_input?.description ?? "");
const cwd = String(input.cwd ?? process.cwd());

// Only Bash can mutate the DB or the policy tree (Edit/Write tools are
// file-only here and engine-side R5 governs .rigorix/** writes anyway).
if (tool !== "Bash") {
  process.exit(0);
}

// ── 1. Direct DB-tool invocation (invocation, NOT keyword presence) ─────────
// A command only counts as a mutation if it actually INVOKES a DB tool.
// `grep "DELETE FROM"` or `git show ...remove.sh` merely mention keywords in
// a pattern/arg — those are benign reads and must pass.
const DB_TOOL_INVOCATION = [
  /\bpsql\b/,           // psql client (any flags)
  /\bpg_dump\b/,
  /\bpg_restore\b/,
  /\bmysql\b/,
  /\bsqlite3\b/,
  /docker exec[^;|&]*\b(psql|pg_dump|pg_restore|mysql)\b/i,
  /docker exec[^;|&]*rgx-conf-db/i, // any exec into the conference DB container
];
const invokesDbTool = DB_TOOL_INVOCATION.some((re) => re.test(cmd));

// ── 2. Policy-tree writes via Bash ─────────────────────────────────────────
// Agents never edit .rigorix/**: it is operator-owned policy. Rigorix's R5
// permission enforcer denies these engine-side too; this is the agent-level
// first denial (works even in a session where the engine is not enforcing).
const POLICY_TREE_WRITE = /(?:^|[;&|]\s*)(?:cp|mv|rm|cat\s*>|tee|sed\s+-i|(?:echo|printf)\s+[^>]*>)\s+(['"]?)(?:\.rigorix|.*\/\.rigorix)\//i;
const writesPolicyTree = POLICY_TREE_WRITE.test(cmd);

// ── 3. Script-based DB access (the pg-client bypass) ───────────────────────
// `node script.mjs` / `python script.py` where the script opens a DB client
// and contains write-intent SQL. Read-only inspection (the demo's
// verify*.sh scripts) is allowed; write statements are denied.
function scriptWriteIntent(path) {
  if (!path || !existsSync(path)) return null;
  try {
    const src = readFileSync(path, "utf8");
    const opensDbClient = /require\(['"]pg['"]\)|from ['"]pg['"]|Client\(|Pool\(|psycopg|sqlalchemy|connect\(/i.test(src);
    if (!opensDbClient) return null;
    const writeIntents = [
      /\bALTER TABLE\b/i,
      /\bCREATE TABLE\b/i,
      /\bDROP TABLE\b/i,
      /\bTRUNCATE\b/i,
      /\bINSERT INTO\b/i,
      /\bUPDATE\b[\s\S]{0,80}\bSET\b/i,
      /\bDELETE FROM\b/i,
      /\bADD COLUMN\b/i,
    ];
    const hit = writeIntents.find((re) => re.test(src));
    return hit ? `script contains write intent (${hit.source})` : null;
  } catch {
    return null;
  }
}

// Extract a script path from a node/python invocation.
function scriptPathFromCommand(cmdStr) {
  const m = cmdStr.match(/(?:^|[;&|]\s*)(?:node|python3?|python|deno|bun)\s+(['"]?)([^\s'";&|]+\.(?:m?js|mjs|c?js|py|ts))\1/);
  return m ? join(cwd, m[2]) : null;
}

const scriptReason = scriptPathFromCommand(cmd) ? scriptWriteIntent(scriptPathFromCommand(cmd)) : null;
const isMutation = invokesDbTool || scriptReason !== null || writesPolicyTree;

if (!isMutation) {
  // Not a DB mutation or policy edit — exploration, tests, edits pass.
  process.exit(0);
}

const reason = scriptReason ?? (writesPolicyTree ? ".rigorix/ policy-tree write" : "direct DB-tool invocation");
const message =
  `Seat changes in the conference registry are critical operations governed by Rigorix (denied: ${reason}). ` +
  "Do not run psql/docker/DB-client commands or edit .rigorix/ directly. " +
  "Hand off to Rigorix: call rigorix_run with template_name 'attendance-remove' / " +
  "'attendance-add' / 'waitlist-transfer' / 'restore-seat' — then " +
  "rigorix_approve_execution when it pauses (sequence policy may also deny " +
  "remove-then-reassign plans outright).";
// Claude Code reads the deny decision from stdout JSON + exit 2; Codex reads
// the blocking reason from stderr when the hook exits 2. Emit both so the
// same script enforces the boundary in either agent.
console.log(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: message,
    },
  }),
);
console.error(message);
process.exit(2);
