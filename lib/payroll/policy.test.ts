import { describe, expect, it } from "vitest";
import {
  canMarkPayrollRunPaid,
  canMutatePayrollRun,
  canMutatePayrollRunItem,
  canReviewTimeCard,
  canSetPayrollRunStatus,
  computePaidValue,
  isPayrollItemStatus,
  isPayrollRunStatus,
  maxWeeklyHours,
  payrollRunStatuses,
  validateHourlyRate,
  validatePayrollHours,
} from "./policy";

describe("status guards", () => {
  it("recognises exactly the statuses the database allows", () => {
    for (const status of payrollRunStatuses) expect(isPayrollRunStatus(status)).toBe(true);
    expect(isPayrollRunStatus("Paid")).toBe(false);
    expect(isPayrollRunStatus("settled")).toBe(false);
    expect(isPayrollRunStatus(null)).toBe(false);
    expect(isPayrollItemStatus("draft")).toBe(false);
    expect(isPayrollItemStatus("ready")).toBe(true);
  });
});

describe("validatePayrollHours", () => {
  it("accepts ordinary and zero hours", () => {
    expect(validatePayrollHours(40)).toEqual({ ok: true, value: 40 });
    expect(validatePayrollHours(0)).toEqual({ ok: true, value: 0 });
    expect(validatePayrollHours("37.5")).toEqual({ ok: true, value: 37.5 });
  });

  it("rejects the values that used to multiply straight into pay", () => {
    // The exact gap: the old code validated the rate and never the hours.
    expect(validatePayrollHours(-8).ok).toBe(false);
    expect(validatePayrollHours(Number.NaN).ok).toBe(false);
    expect(validatePayrollHours("abc").ok).toBe(false);
    expect(validatePayrollHours(Infinity).ok).toBe(false);
  });

  it("rejects a blank field instead of paying it as zero hours", () => {
    // Number(null) and Number("") are both 0, so without an explicit check a
    // missing value would validate cleanly as a week worked for nothing.
    expect(validatePayrollHours(null).ok).toBe(false);
    expect(validatePayrollHours(undefined).ok).toBe(false);
    expect(validatePayrollHours("").ok).toBe(false);
    expect(validatePayrollHours("   ").ok).toBe(false);
    expect(validateHourlyRate(null).ok).toBe(false);
    expect(validateHourlyRate("").ok).toBe(false);
  });

  it("rejects more hours than a week physically contains", () => {
    expect(validatePayrollHours(maxWeeklyHours).ok).toBe(true);
    const tooMany = validatePayrollHours(1000);
    expect(tooMany.ok).toBe(false);
    expect(tooMany.reason).toContain("168");
  });
});

describe("validateHourlyRate", () => {
  it("accepts a real rate and rejects nonsense", () => {
    expect(validateHourlyRate(42.5)).toEqual({ ok: true, value: 42.5 });
    expect(validateHourlyRate(0).ok).toBe(true);
    expect(validateHourlyRate(-1).ok).toBe(false);
    expect(validateHourlyRate("x").ok).toBe(false);
  });
});

describe("computePaidValue", () => {
  it("rounds to cents", () => {
    expect(computePaidValue(33.333, 3)).toBe(100);
    expect(computePaidValue(21.5, 37.5)).toBe(806.25);
  });

  it("does not silently clamp bad input — validation is the caller's job", () => {
    // Deliberate: if this clamped, a caller could skip validation and still get
    // a plausible number back, which is how the original bug stayed invisible.
    expect(computePaidValue(10, -5)).toBe(-50);
  });
});

describe("canMarkPayrollRunPaid", () => {
  it("allows paying a draft or ready run, matching how the tracker is used", () => {
    expect(canMarkPayrollRunPaid("draft").ok).toBe(true);
    expect(canMarkPayrollRunPaid("ready").ok).toBe(true);
  });

  it("refuses to pay a run twice", () => {
    const gate = canMarkPayrollRunPaid("paid");
    expect(gate.ok).toBe(false);
    expect(gate.reason).toContain("already been marked paid");
  });

  it("refuses to pay a run that is on hold", () => {
    const gate = canMarkPayrollRunPaid("held");
    expect(gate.ok).toBe(false);
    expect(gate.reason).toContain("Release the hold");
  });

  it("refuses an unrecognised status rather than guessing", () => {
    expect(canMarkPayrollRunPaid("settled").ok).toBe(false);
    expect(canMarkPayrollRunPaid(undefined).ok).toBe(false);
  });
});

describe("canMutatePayrollRun", () => {
  it("freezes a paid run", () => {
    const gate = canMutatePayrollRun("paid");
    expect(gate.ok).toBe(false);
    expect(gate.reason).toContain("can no longer be edited");
  });

  it("leaves unpaid runs editable", () => {
    expect(canMutatePayrollRun("draft").ok).toBe(true);
    expect(canMutatePayrollRun("ready").ok).toBe(true);
    expect(canMutatePayrollRun("held").ok).toBe(true);
  });
});

describe("canSetPayrollRunStatus", () => {
  it("blocks moving a paid run back to draft, which would erase the payment record", () => {
    const gate = canSetPayrollRunStatus("paid", "draft");
    expect(gate.ok).toBe(false);
    expect(gate.reason).toContain("can no longer be edited");
  });

  it("routes paying through the dedicated action so it gets stamped", () => {
    const gate = canSetPayrollRunStatus("draft", "paid");
    expect(gate.ok).toBe(false);
    expect(gate.reason).toContain("Mark paid");
  });

  it("allows ordinary transitions", () => {
    expect(canSetPayrollRunStatus("draft", "ready").ok).toBe(true);
    expect(canSetPayrollRunStatus("ready", "held").ok).toBe(true);
  });

  it("rejects an unknown target status", () => {
    expect(canSetPayrollRunStatus("draft", "settled").ok).toBe(false);
  });
});

describe("canMutatePayrollRunItem", () => {
  it("freezes items once their run is paid", () => {
    expect(canMutatePayrollRunItem("paid").ok).toBe(false);
    expect(canMutatePayrollRunItem("draft").ok).toBe(true);
  });
});

describe("canReviewTimeCard", () => {
  it("blocks re-deciding a card whose money is already inside a payroll run", () => {
    const gate = canReviewTimeCard(true);
    expect(gate.ok).toBe(false);
    expect(gate.reason).toContain("already part of a payroll run");
  });

  it("allows correcting a card that has not reached payroll yet", () => {
    expect(canReviewTimeCard(false).ok).toBe(true);
  });
});
