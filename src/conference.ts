// conference.ts — the conference registration service domain.
//
// This is the code a coding agent (Claude Code / Codex) owns and edits
// freely. It is PURE logic: no DB handle, no tool that can mutate the live
// registry. Mutations of the real registry (the `conference` database behind
// docker compose) are CRITICAL operations that Rigorix executes as governed,
// approved, auditable runbooks — never from this module or an agent's Bash.
//
// The seat invariants below mirror the demo's conference (`conf-2026`,
// capacity 100, waitlist). Keep them honest: they are the operator's intent
// encoded where the agent can read it.

export interface Registration {
  email: string;
  name: string;
  status: "registered" | "waitlisted" | "removed";
}

export interface ConferenceState {
  id: string;
  capacity: number;
  registrations: Registration[];
}

export type Mutation =
  | { kind: "register"; email: string; name: string }
  | { kind: "remove"; email: string }
  | { kind: "transfer"; from: string; to: string; toName: string };

export interface MutationPlan {
  /** The seat mutations the operator must run through Rigorix. */
  steps: Mutation[];
  /** Human-readable explanation shown before anything runs. */
  intent: string;
  /** True when this plan is the legitimate path (vs a denied sequence). */
  legitimate: boolean;
}

const WARNINGS = {
  capacityFull: (conf: ConferenceState) =>
    `${conf.id} is full (${countRegistered(conf)}/${conf.capacity})`,
};

export function countRegistered(conf: ConferenceState): number {
  return conf.registrations.filter((r) => r.status === "registered").length;
}

/**
 * A registration is legal only when the conference is not full and the email
 * is not already registered. Waitlist entrants are not yet registered.
 */
export function canRegister(conf: ConferenceState, email: string): boolean {
  const present = conf.registrations.some(
    (r) => r.email === email && r.status !== "removed",
  );
  return !present && countRegistered(conf) < conf.capacity;
}

export function find(conf: ConferenceState, email: string): Registration | undefined {
  return conf.registrations.find((r) => r.email === email);
}

/**
 * The remove-then-reassign pattern — the abuse in the conference-seat case
 * seat case (2026-09-03). Each individual action passes every per-action
 * gate; the PAIR is the problem. Rigorix encodes this as a sequence policy:
 * the composition is refused at plan time (R2) and, across runs, refused
 * from the signed trail (R7). This function exists so the service code and
 * the policy tell the SAME story — a "reassign to a freed seat" request
 * surfaces as two steps the agent cannot run itself.
 */
export function planReassign(
  conf: ConferenceState,
  victimEmail: string,
  requesterEmail: string,
  requesterName: string,
): MutationPlan {
  const victim = find(conf, victimEmail);
  const steps: Mutation[] = [];
  let legitimate = true;

  if (!victim || victim.status !== "registered") {
    return {
      steps: [],
      intent: `No registered attendee '${victimEmail}' — nothing to reassign.`,
      legitimate: false,
    };
  }

  if (requesterEmail === victimEmail) {
    return {
      steps: [],
      intent: `'${victimEmail}' is already registered; no reassignment needed.`,
      legitimate: false,
    };
  }

  // The operator intent: a NEW person takes the vacated seat (a no-show
  // transfer). Removing someone merely to slot in a friend is the denied
  // sequence — the policy layer, not this code, decides.
  const canAdd = canRegister(conf, requesterEmail);
  steps.push({ kind: "remove", email: victimEmail });
  steps.push({ kind: "register", email: requesterEmail, name: requesterName });

  return {
    steps,
    intent: canAdd
      ? `Remove ${victimEmail} (no-show) and register ${requesterEmail} in the freed seat.`
      : WARNINGS.capacityFull(conf),
    legitimate: canAdd && victim.status === "registered",
  };
}

/** The legitimate waitlist path: verify the no-show, then transfer. */
export function planWaitlistTransfer(
  conf: ConferenceState,
  noShowEmail: string,
  waitlistEmail: string,
  waitlistName: string,
): MutationPlan {
  const noShow = find(conf, noShowEmail);
  if (!noShow || noShow.status !== "registered") {
    return {
      steps: [],
      intent: `'${noShowEmail}' is not a registered attendee — nothing to transfer.`,
      legitimate: false,
    };
  }
  return {
    steps: [
      { kind: "remove", email: noShowEmail },
      { kind: "register", email: waitlistEmail, name: waitlistName },
    ],
    intent: `Transfer ${noShowEmail}'s seat to waitlisted ${waitlistEmail}.`,
    legitimate: true,
  };
}
