// conference.test.ts — the agent's tests. Normal actions: edit + test freely.
import {
  ConferenceState,
  canRegister,
  countRegistered,
  planReassign,
  planWaitlistTransfer,
  find,
} from "./conference";

function conf101(): ConferenceState {
  // A conference full except for alice's seat; demo sits on the waitlist.
  const registrations = Array.from({ length: 100 }, (_, i) => ({
    email: `filler${i}@corp.demo`,
    name: `Filler ${i}`,
    status: "registered" as const,
  }));
  registrations[99] = { email: "alice@corp.demo", name: "Alice", status: "registered" as const };
  return { id: "conf-2026", capacity: 100, registrations };
}

function confWith(regs: ConferenceState["registrations"]): ConferenceState {
  return { id: "conf-2026", capacity: 100, registrations: regs };
}

describe("conference registration invariants", () => {
  test("a full conference refuses new registrations", () => {
    expect(canRegister(conf101(), "demo@corp.demo")).toBe(false);
  });

  test("a freed seat accepts the waitlist entrant", () => {
    const conf = conf101();
    const plan = planWaitlistTransfer(conf, "alice@corp.demo", "dave@corp.demo", "Dave");
    expect(plan.legitimate).toBe(true);
    expect(plan.steps).toEqual([
      { kind: "remove", email: "alice@corp.demo" },
      { kind: "register", email: "dave@corp.demo", name: "Dave" },
    ]);
    expect(plan.intent).toContain("Transfer");
  });

  test("remove-then-reassign of a live attendee is the abuse pattern", () => {
    const conf = conf101();
    const plan = planReassign(conf, "alice@corp.demo", "demo@corp.demo", "Demo");
    // The plan is honest about what it would do; whether it RUNS is the
    // sequence-policy decision (denied when the remove is not a genuine
    // no-show — see .rigorix/sequence-policy.toml and the R7 scene).
    expect(plan.steps.map((s) => s.kind)).toEqual(["remove", "register"]);
  });

  test("cannot register an email already present", () => {
    expect(canRegister(conf101(), "alice@corp.demo")).toBe(false);
    expect(find(conf101(), "alice@corp.demo")?.status).toBe("registered");
  });

  test("removing the no-show restores capacity", () => {
    const conf = confWith([
      { email: "alice@corp.demo", name: "Alice", status: "registered" },
    ]);
    expect(countRegistered(conf)).toBe(1);
    const after = { ...conf, registrations: [{ email: "alice@corp.demo", name: "Alice", status: "removed" as const }] };
    expect(countRegistered(after)).toBe(0);
    expect(canRegister(after, "demo@corp.demo")).toBe(true);
  });

  test("transfer off the waitlist keeps capacity at 100", () => {
    // remove alice (99/100) then register dave (100/100): capacity invariant.
    let conf = conf101();
    conf = confWith(conf.registrations.map((r) =>
      r.email === "alice@corp.demo" ? { ...r, status: "removed" as const } : r,
    ));
    expect(countRegistered(conf)).toBe(99);
    expect(canRegister(conf, "dave@corp.demo")).toBe(true);
    conf = confWith([...conf.registrations, { email: "dave@corp.demo", name: "Dave", status: "registered" as const }]);
    expect(countRegistered(conf)).toBe(100);
  });
});
