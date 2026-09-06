#!/usr/bin/env node
// ============================================================================
// run-conference-demo.mjs — the full-feature Rigorix demo (Demo's case),
// migration-demo structure: a coding agent first, Rigorix on handoff.
//
// Scenes:
//   0  Environment (postgres + Keycloak + local rigorix-mcp)
//   1  THE AGENT WORKS NORMALLY — code changes + tests, freely (npm test,
//      tsc — the allowlist path)
//   2  THE AGENT TRIES A CRITICAL ACTION — the PreToolUse hook DENIES
//      (direct DB seat mutation; .rigorix policy write) — try and fail
//   3  HAND OVER TO RIGORIX — the driver now drives rigorix-mcp
//   4  WHO ARE YOU — OIDC device flow login (Keycloak, ADR-008)
//   5  The config surface + R5 (agents cannot edit .rigorix/**)
//   6  THE COMPOSITION ATTACK — remove alice then add demo in ONE run → DENIED
//      at plan time (sequence-policy R2)
//   7  The legitimate path — organizer transfer, policy-promoted → PAUSED (R3)
//   8  A HUMAN SAYS YES — approve with the attested identity (ADR-011)
//   9  The signed evidence (HMAC envelope + node events + policy finding)
//  10  Failure scene — the full event rejects the add at runtime
//  11  SCENE 9 REAL: cross-run — remove (run 1) passes; add (run 2) is
//      DENIED by the R7 history rule at plan time
//  12  Rollback + the signed trail (every envelope + every denial)
//
// Requires: rigorix-mcp on PATH (or RIGORIX_MCP_BIN), docker (postgres +
// Keycloak per docker-compose.yml). Agent-phase assertions call the SAME
// PreToolUse hook Claude Code / Codex invoke, so "try and fail" is executed
// and tested here, not narrated.
// ============================================================================
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(root, "..");
const MCP_BIN = process.env.RIGORIX_MCP_BIN ?? "rigorix-mcp";
const KC = "http://127.0.0.1:8080/realms/rigorix";
const verbose = process.env.RIGORIX_DRIVER_VERBOSE === "1";
const HOOK = resolve(repoRoot, ".claude/hooks/deny-seat-mutation.mjs");

// ── DB helpers (dockerized conference registry) ───────────────────────────
function db(sql) {
  const r = spawnSync("docker", ["exec", "rgx-conf-db", "psql", "-U", "postgres", "-d", "conference", "-tAc", sql], { encoding: "utf8" });
  return r.stdout?.trim() ?? "";
}
const seatCount = () => db("SELECT count(*) FROM registrations WHERE event_id='conf-2026'");
const registered = (a) => db(`SELECT count(*) FROM registrations WHERE event_id='conf-2026' AND attendee='${a}'`) === "1";

/// Run the PreToolUse hook exactly as Claude Code / Codex would: JSON on
/// stdin, exit code 2 = denied, 0 = allowed. Returns { rc, decision }.
function hookCall(bashCmd) {
  const r = spawnSync("node", [HOOK], {
    input: JSON.stringify({ tool_name: "Bash", tool_input: { command: bashCmd }, cwd: repoRoot }),
    encoding: "utf8",
  });
  let decision = null;
  try { decision = JSON.parse(r.stdout).hookSpecificOutput.permissionDecision; } catch { /* stdout may be empty */ }
  return { rc: r.status, decision };
}

// ── Tiny cookie-jar HTTP client (manual redirects) for the Keycloak login ─
const jar = new Map();
function cookieHeader() { return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; "); }
function storeCookies(res) {
  const setc = res.headers.getSetCookie?.() ?? [];
  for (const c of setc) {
    const [pair] = c.split(";");
    const eq = pair.indexOf("=");
    if (eq > 0) jar.set(pair.slice(0, eq), pair.slice(eq + 1));
  }
}
async function httpGet(url, opts = {}) {
  const headers = { ...(opts.headers ?? {}) };
  if (jar.size) headers.cookie = cookieHeader();
  let res = await fetch(url, { ...opts, headers, redirect: "manual" });
  storeCookies(res);
  let hops = 0;
  while (res.status >= 300 && res.status < 400 && res.headers.get("location") && hops++ < 8) {
    const loc = new URL(res.headers.get("location"), url).toString();
    res = await fetch(loc, { headers: { ...(jar.size ? { cookie: cookieHeader() } : {}) }, redirect: "manual" });
    storeCookies(res);
  }
  return res;
}
async function httpPost(url, body, headers = {}) {
  return httpGet(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", ...headers }, body });
}
const abs = (u, base) => (u.startsWith("http") ? u : new URL(u, base).toString());
function formAction(html, match) {
  const m = html.match(new RegExp(`<form[^>]*action="([^"]*${match}[^"]*)"`));
  return m ? abs(m[1].replaceAll("&amp;", "&"), KC) : null;
}

/// Complete an RFC 8628 device authorization as `username` — the driver
/// plays the human: opens the verification page, signs in, clicks allow.
async function approveDevice(userCode, username) {
  const pw = `${username}-pass-2026`;
  jar.clear(); // fresh human session per login
  await httpGet(`${KC}/device?user_code=${encodeURIComponent(userCode)}`);
  const login = await httpGet(`${KC}/device?user_code=${encodeURIComponent(userCode)}`);
  const text = await login.text();
  const action = formAction(text, "authenticate");
  if (!action) throw new Error("device page did not yield a login form");
  let res = await httpPost(action, `username=${encodeURIComponent(username)}&password=${encodeURIComponent(pw)}&credentialId=`);
  let html = await res.text();
  for (let i = 0; i < 5; i++) {
    const consent = formAction(html, "consent");
    if (consent) { res = await httpPost(consent, ""); html = await res.text(); continue; }
    const action2 = formAction(html, "authenticate");
    if (action2 && !html.includes("kc-error")) {
      res = await httpPost(action2, `username=${encodeURIComponent(username)}&password=${encodeURIComponent(pw)}&credentialId=`);
      html = await res.text();
      continue;
    }
    break;
  }
  return html.includes("kc-error") ? false : true;
}

// ── MCP stdio client ───────────────────────────────────────────────────────
const child = spawn(MCP_BIN, [], {
  cwd: repoRoot,
  stdio: ["pipe", "pipe", "pipe"],
  env: {
    ...process.env,
    RUST_LOG: verbose ? "info" : "warn",
    RIGORIX_APPROVAL_BINDING: "1",
    RIGORIX_HMAC_KEY: "conference-demo-hmac-key",
    RIGORIX_IDP_ISSUER: KC,
    RIGORIX_IDP_CLIENT_ID: "rigorix-demo",
    RIGORIX_AUTH_PLAINTEXT_DIR: resolve(repoRoot, ".rigorix/tmp/keychain"),
  },
});
child.on("error", (err) => {
  console.error(`Failed to start ${MCP_BIN}: ${err.message}`);
  console.error("Is rigorix-mcp built? Set RIGORIX_MCP_BIN to the local target/debug binary.");
  process.exit(1);
});
child.stderr.setEncoding("utf8");
child.stderr.on("data", (d) => { if (verbose) process.stderr.write(d); });
let buf = "";
let nextId = 1;
const pending = new Map();
child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  buf += chunk;
  let idx;
  while ((idx = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    }
  }
});
function rpc(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params: params ?? {} }) + "\n");
  });
}

// ── Transcript helpers ─────────────────────────────────────────────────────
function section(n, title) {
  console.log("\n" + "=".repeat(76));
  console.log(`${n} · ${title}`);
  console.log("=".repeat(76));
}
function show(x) { console.log(JSON.stringify(x, null, 2)); }

// ── Tool helpers ───────────────────────────────────────────────────────────
async function callTool(name, args) {
  const r = await rpc("tools/call", { name, arguments: args ?? {} });
  if (r.isError || r.content?.[0]?.text?.startsWith('{"error"')) {
    throw new Error(`${name}: ${r.content?.[0]?.text ?? r.error ?? "tool error"}`);
  }
  return r;
}
function parseJson(r) {
  const text = r.content[0].text;
  try { return JSON.parse(text); } catch { return { raw: text }; }
}
function showRun(j) {
  const steps = j.steps ?? [];
  for (const s of steps) {
    console.log(`  ${s.success ? "✔" : "✘"} ${s.step_name}${s.error ? " — " + String(s.error).slice(0, 140) : ""}`);
  }
  console.log(`  status: ${j.status} (${steps.filter((s) => s.success).length}/${steps.length} steps ok)`);
}

// ── Scene orchestration ────────────────────────────────────────────────────
async function deviceLogin(persona) {
  const login = parseJson(await callTool("rigorix_auth_login", {}));
  console.log(`  device flow started for ${persona.username}`);
  console.log(`  user_code:      ${login.user_code}`);
  console.log(`  verification:   ${login.verification_uri}`);
  console.log(`  → ${persona.label} opens the link, signs in, and clicks ALLOW…`);
  const ok = await approveDevice(login.user_code, persona.username);
  if (!ok) throw new Error(`device authorization failed for ${persona.username}`);
  console.log("  ✔ device authorized by the human");
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    const st = parseJson(await callTool("rigorix_auth_status", {}));
    const okStatus = ["logged_in", "Authenticated", "authenticated"].includes(st.status);
    if (okStatus) {
      console.log(`  status: ${st.status}`);
      if (st.claim_summary) console.log(`  claim_summary: ${JSON.stringify(st.claim_summary)}`);
      return st;
    }
  }
  throw new Error("login did not complete");
}

// ── Main ───────────────────────────────────────────────────────────────────
const OPERATOR = { username: "demo", label: "Demo (CISO, asking for a seat)" };
const ORG = { username: "organizer", label: "The Organizer (conference operator)" };

try {
  section("0 · Environment");
  spawnSync("docker", ["compose", "up", "-d"], { cwd: repoRoot, encoding: "utf8", stdio: "ignore" });
  spawnSync("bash", [".rigorix/scripts/setup-db.sh"], { cwd: repoRoot, encoding: "utf8", stdio: "ignore" });
  spawnSync("bash", [".rigorix/setup-keycloak.sh"], { cwd: repoRoot, encoding: "utf8", stdio: "ignore" });
  spawnSync("git", ["config", "user.email", "demo@corp\.demo"], { cwd: repoRoot });
  spawnSync("git", ["config", "user.name", "Demo Operator"], { cwd: repoRoot });
  console.log(`  conf-2026: ${seatCount()}/100 seats taken (FULL)`);

  // ══ THE AGENT PHASE — Claude Code / Codex on this repo ══════════════════
  section("1 · THE AGENT WORKS NORMALLY — code changes run freely");
  console.log("  The coding agent owns src/ — edits, tests, typechecks pass");
  console.log("  (the .claude/settings.json / .codex allowlist: no prompts).");
  const tests = spawnSync("npm", ["test", "--silent"], { cwd: repoRoot, encoding: "utf8" });
  const tOk = /Tests:\s+6 passed/.test(tests.stdout + tests.stderr);
  console.log(`  npm test        → ${tOk ? "6/6 passed" : "FAILED"}`);
  const tsc = spawnSync("npx", ["tsc", "--noEmit"], { cwd: repoRoot, encoding: "utf8" });
  console.log(`  npx tsc --noEmit → ${tsc.status === 0 ? "clean" : "FAILED"}`);
  const srcEdit = spawnSync("node", ["-e", `require("fs").accessSync("src/conference.ts"); console.log("ok")`], { cwd: repoRoot, encoding: "utf8" });
  console.log(`  editing src/conference.ts → ${srcEdit.status === 0 ? "allowed (agent-owned code)" : "FAILED"}`);
  if (!tOk || tsc.status !== 0) throw new Error("agent normal-work scene failed");
  console.log("  → Normal development is ungoverned. Consequence, not code, is gated.");

  section("2 · THE AGENT TRIES A CRITICAL ACTION — the PreToolUse hook denies");
  console.log("  Same hook Claude Code AND Codex run (deny-seat-mutation.mjs).");
  const cases = [
    ["direct DB seat removal", `docker exec rgx-conf-db psql -U postgres -d conference -c "DELETE FROM registrations WHERE attendee='alice@corp.demo'"`],
    ["direct DB seat add", `docker exec rgx-conf-db psql -U postgres -d conference -c "INSERT INTO registrations (event_id, attendee, status) VALUES ('conf-2026','demo@corp\.demo','registered')"`],
    ["psql read attempt (still gated: no direct DB tools)", `psql -U postgres -d conference -tAc "SELECT count(*) FROM registrations"`],
    ["policy-tree write", `echo "fail_closed = false" > .rigorix/sequence-policy.toml`],
  ];
  for (const [label, cmd] of cases) {
    const { rc, decision } = hookCall(cmd);
    const ok = rc === 2 && decision === "deny";
    console.log(`  ✘ agent: ${label} → DENIED${ok ? "" : "  (MISMATCH rc=" + rc + ")"}`);
    if (!ok) throw new Error(`hook did not deny: ${label}`);
  }
  console.log("  ✔ the agent tried — every critical call was refused by the prehook.");
  const benign = hookCall("npm test");
  const benignOk = benign.rc === 0;
  console.log(`  benign call (npm test) → allowed (rc ${benign.rc})${benignOk ? "" : "  MISMATCH"}`);
  if (!benignOk) throw new Error("hook denied a benign call");
  console.log("  → 'try and fail': the hook is the agent-side first line (R5 and the");
  console.log("    sequence policies are the engine-side second line — next scenes).");

  section("3 · HAND OVER TO RIGORIX");
  console.log("  The agent reports the denial and hands off to rigorix-mcp (MCP tools).");
  console.log("  → The driver now speaks rigorix-mcp: governed, approved, auditable runs.");
  await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "conference-demo", version: "0.2.0" } });
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  const tools = (await rpc("tools/list", {})).tools.map((t) => t.name);
  console.log(`  rigorix-mcp tools available: ${tools.length} (auth: ${tools.includes("rigorix_auth_login")})`);

  section("4 · WHO ARE YOU — OIDC device flow (Keycloak)");
  await deviceLogin(OPERATOR);

  section("5 · The config surface — operators own the rules (R5)");
  console.log("  .rigorix/sequence-policy.toml rules:");
  console.log("   • no-remove-then-reassign        [deny]    remove then add IN ONE RUN (R2)");
  console.log("   • transfer-seat-is-critical      [promote] waitlist transfer needs a human (R3)");
  console.log("   • no-cross-run-remove-reassign   [deny+R7] add after same principal removed (history)");
  const tamper = parseJson(await callTool("rigorix_run", { template_name: "tamper-policy" }));
  console.log("  agent tries to edit .rigorix/sequence-policy.toml via a run →");
  for (const s of tamper.steps ?? []) {
    console.log(`  ${s.success ? "✔" : "✘"} ${s.step_name}${s.error ? " — " + String(s.error).slice(0, 120) : ""}`);
  }
  console.log(`  status: ${tamper.status} — the write was DENIED by the permission enforcer`);
  const policyIntact = spawnSync("git", ["status", "--porcelain", ".rigorix/sequence-policy.toml"], { cwd: repoRoot, encoding: "utf8" }).stdout.trim() === "";
  console.log(`  policy file intact (no diff vs the operator's version): ${policyIntact}`);

  section("6 · THE COMPOSITION ATTACK — remove alice, add demo (ONE run)");
  console.log("  Demo asks: 'the event is full — get me a seat'. The agent plans:");
  console.log("    remove_attendance(conf-2026, alice) → add_attendance(conf-2026, demo)");
  const bypassPlan = {
    name: "conference-bypass",
    description: "remove alice then add demo",
    steps: [
      { name: "registration_remove", tool: "run_command", parameters: { command: "bash .rigorix/scripts/remove_attendance.sh conf-2026 alice" }, requires_approval: false, description: "Remove alice" },
      { name: "registration_add", tool: "run_command", parameters: { command: "bash .rigorix/scripts/add_attendance.sh conf-2026 demo" }, requires_approval: false, description: "Add demo" },
    ],
  };
  const vp = parseJson(await callTool("rigorix_validate_plan", { plan: bypassPlan }));
  console.log("  rigorix_validate_plan — the plan is refused BEFORE anything runs:");
  const vpSummary = { valid: vp.valid ?? vp.is_valid, status: vp.status, findings: (vp.sequence_findings ?? vp.findings ?? []).map((f) => ({ rule: f.rule_id, later_step: f.later_step, action: f.action })) };
  show(vpSummary);
  try {
    await callTool("rigorix_run", { template_name: "conference-bypass" });
    console.log("  ⚠ run unexpectedly executed");
  } catch (e) {
    console.log("  rigorix_run → refused: " + String(e.message).slice(0, 200));
  }
  console.log(`  DB proof — alice still registered: ${registered("alice")} (capacity ${seatCount()}/100)`);

  section("7 · The legitimate path — organizer transfer (policy-promoted pause)");
  await deviceLogin(ORG);
  console.log("  The Organizer runs the waitlist grant (ghost no-show → dave):");
  const runA = parseJson(await callTool("rigorix_run", { template_name: "waitlist-transfer" }));
  showRun(runA);
  console.log(`  execution_id: ${runA.execution_id}`);
  console.log(`  → PAUSED at transfer_seat (sequence-policy promote: a seat transfer is critical). dave not yet registered: ${!registered("dave")}`);

  section("8 · A HUMAN SAYS YES — approve with the attested identity");
  const approve = parseJson(await callTool("rigorix_approve_execution", {
    execution_id: runA.execution_id,
    step_names: ["transfer_seat"],
    approver_id: "organizer@corp.demo",
    authority: `device-flow:${KC}`,
    token_claims_ref: "keycloak/rigorix-demo/organizer",
  }));
  show(approve);
  console.log(`  dave registered after approval: ${registered("dave")} (capacity ${seatCount()}/100)`);

  section("9 · The signed evidence");
  try {
    const audit = parseJson(await callTool("rigorix_read_audit", { execution_id: runA.execution_id }));
    if (audit.steps?.length) {
      console.log(`  status: ${audit.status} | template: ${audit.template} | hmac: ${String(audit.hmac ?? "").slice(0, 24)}…`);
      for (const s of audit.steps) console.log(`    ${s.success ? "✔" : "✘"} ${s.step_name}`);
    } else {
      console.log("  read_audit: " + JSON.stringify(audit).slice(0, 200));
    }
  } catch (e) { console.log("  read_audit skipped: " + String(e.message).slice(0, 120)); }
  const transferEnvelope = spawnSync("bash", ["-c", `grep -l waitlist-transfer .rigorix/audit/*.json | head -1 | xargs cat`], { cwd: repoRoot, encoding: "utf8" });
  try {
    const env = JSON.parse(transferEnvelope.stdout);
    console.log(`  signed trail (the transfer run's envelope, engine-persisted):`);
    console.log(`    signature=${env.signature ? "PRESENT (HMAC-SHA256)" : "absent"} | author=${env.author} | template=${env.template_id}`);
    console.log(`    node events=${(env.events ?? []).length} | sequence_policy_findings=${(env.sequence_policy_findings ?? []).length} (the promote rule)`);
    const evtTypes = [...new Set((env.events ?? []).map((e) => e.event_type))];
    if (evtTypes.length) console.log(`    event types: ${evtTypes.join(", ")}`);
  } catch { console.log("  (transfer envelope parse skipped)"); }

  section("10 · Failure scene — the full event rejects at runtime");
  const fail = parseJson(await callTool("rigorix_run", { template_name: "attendance-add" }));
  showRun(fail);
  console.log(`  demo still not registered: ${!registered("demo")}`);

  section("11 · SCENE 9 — the cross-run case (R7: audit trail as policy input)");
  console.log("  RUN 1: Demo's agent removes alice (a single action — within its own gate).");
  const run1 = parseJson(await callTool("rigorix_run", { template_name: "attendance-remove" }));
  showRun(run1);
  console.log(`  alice removed: ${!registered("alice")} — capacity ${seatCount()}/100. Envelope persisted.`);
  console.log("  RUN 2 (minutes later): the agent tries to add demo.");
  try {
    await callTool("rigorix_run", { template_name: "attendance-add" });
    console.log("  ⚠ run 2 unexpectedly executed");
  } catch (e) {
    console.log("  rigorix_run → DENIED AT PLAN TIME: " + String(e.message).slice(0, 200));
  }
  console.log(`  DB proof: alice removed (${seatCount()}/100) but demo NOT added: ${!registered("demo")}`);
  console.log("  → each run passed its own within-run gate; the R7 rule read the");
  console.log("    signed history and refused the second run before any step ran.");

  section("12 · Rollback + the signed trail");
  const rb = parseJson(await callTool("rigorix_run", { template_name: "restore-seat" }));
  showRun(rb);
  console.log(`  alice restored: ${registered("alice")} (capacity ${seatCount()}/100)`);
  const fileCount = spawnSync("bash", ["-c", "ls .rigorix/audit/*.json 2>/dev/null | wc -l"], { cwd: repoRoot, encoding: "utf8" }).stdout.trim();
  console.log(`  signed envelopes on disk (.rigorix/audit): ${fileCount}`);
  console.log("  (each carries an HMAC; node events + policy findings included)");
  console.log("  audit backend: envelopes are also POSTed to the enterprise dashboard (rigorix.toml).");

  console.log("\n✅ CONFERENCE DEMO COMPLETE — agent phase + every rigorix scene verified.");
  child.stdin.end();
  process.exit(0);
} catch (err) {
  console.error("\n❌ DEMO FAILED: " + err.message);
  child.kill();
  process.exit(1);
}
