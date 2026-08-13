// The rules that protect wages.
//
// Pure and side-effect free so every rule is testable without a database,
// following lib/time-off/policy.ts. The server actions consult this before
// writing; nothing here touches Supabase.
//
// WHY THIS EXISTS: payroll, time cards, finance and expenses were the four
// action files in the codebase with no tests and no audit trail, and reading
// them surfaced real gaps — hours were never validated, a run could be marked
// paid twice or paid straight out of a hold, a run already paid could still be
// edited, and an approved time card could be un-approved after its money was
// already inside a payroll run.

export const payrollRunStatuses = ["draft", "ready", "paid", "held"] as const;
export const payrollItemStatuses = ["ready", "paid", "held"] as const;

export type PayrollRunStatus = (typeof payrollRunStatuses)[number];
export type PayrollItemStatus = (typeof payrollItemStatuses)[number];

export function isPayrollRunStatus(value: unknown): value is PayrollRunStatus {
  return typeof value === "string" && (payrollRunStatuses as readonly string[]).includes(value);
}

export function isPayrollItemStatus(value: unknown): value is PayrollItemStatus {
  return typeof value === "string" && (payrollItemStatuses as readonly string[]).includes(value);
}

export interface PayrollGate {
  ok: boolean;
  reason?: string;
}

/**
 * Hours on a single weekly time card.
 *
 * A week physically contains 168 hours, and the previous code validated the
 * rate but never the hours — so a negative or NaN figure multiplied straight
 * into paid_value, and a fat-fingered 1000 would have been paid out.
 */
export const maxWeeklyHours = 168;

export interface NumberCheck {
  ok: boolean;
  value?: number;
  reason?: string;
}

/**
 * Rejects the values JavaScript would quietly coerce to 0 — null, undefined,
 * and the empty string. A missing hours field is a gap to be fixed, not a week
 * someone worked for nothing, and Number(null) === 0 would have paid it as the
 * latter.
 */
function isBlank(input: unknown): boolean {
  return input === null || input === undefined || (typeof input === "string" && input.trim() === "");
}

export function validatePayrollHours(input: unknown): NumberCheck {
  if (isBlank(input)) return { ok: false, reason: "Enter the hours worked." };
  const value = typeof input === "number" ? input : Number(input);
  if (!Number.isFinite(value)) return { ok: false, reason: "Enter the hours worked as a number." };
  if (value < 0) return { ok: false, reason: "Hours worked cannot be negative." };
  if (value > maxWeeklyHours) {
    return { ok: false, reason: `Hours worked cannot exceed ${maxWeeklyHours} for a single week.` };
  }
  return { ok: true, value };
}

export function validateHourlyRate(input: unknown): NumberCheck {
  if (isBlank(input)) return { ok: false, reason: "Enter an hourly rate." };
  const value = typeof input === "number" ? input : Number(input);
  if (!Number.isFinite(value)) return { ok: false, reason: "Enter a valid hourly rate." };
  if (value < 0) return { ok: false, reason: "An hourly rate cannot be negative." };
  return { ok: true, value };
}

/**
 * Gross pay for a card, rounded to cents.
 *
 * Both inputs must already have passed validation — this deliberately does no
 * clamping of its own, so a caller cannot skip the checks above and still get
 * a plausible-looking number back.
 */
export function computePaidValue(hourlyRate: number, totalHours: number): number {
  return Number((hourlyRate * totalHours).toFixed(2));
}

/**
 * Paying a run.
 *
 * Reachable from draft and ready, which is how the tracker is actually used —
 * the UI offers "Mark paid" on both. Refused for a run already paid (the guard
 * that was missing: the button is disabled client-side, but a stale page or a
 * second session could still re-stamp paid_at and paid_by), and for a run on
 * hold, since a hold exists precisely to stop the money going out.
 */
export function canMarkPayrollRunPaid(current: unknown): PayrollGate {
  if (!isPayrollRunStatus(current)) return { ok: false, reason: "This payroll run has an unrecognised status." };
  if (current === "paid") return { ok: false, reason: "This payroll run has already been marked paid." };
  if (current === "held") {
    return { ok: false, reason: "This payroll run is on hold. Release the hold before marking it paid." };
  }
  return { ok: true };
}

/**
 * Editing a run or any of its items.
 *
 * A paid run is a record of money that has left the business, so it freezes:
 * without this, updatePayrollRun would happily move a paid run back to draft
 * and null out paid_at/paid_by, erasing the evidence that it was ever paid.
 */
export function canMutatePayrollRun(current: unknown): PayrollGate {
  if (!isPayrollRunStatus(current)) return { ok: false, reason: "This payroll run has an unrecognised status." };
  if (current === "paid") {
    return { ok: false, reason: "This payroll run has been paid and can no longer be edited." };
  }
  return { ok: true };
}

/** Same freeze, applied to an item via the status of the run that owns it. */
export function canMutatePayrollRunItem(runStatus: unknown): PayrollGate {
  if (!isPayrollRunStatus(runStatus)) return { ok: false, reason: "This payroll run has an unrecognised status." };
  if (runStatus === "paid") {
    return { ok: false, reason: "This payroll run has been paid, so its line items can no longer be edited." };
  }
  return { ok: true };
}

/** The status a run may be moved to by an ordinary edit. */
export function canSetPayrollRunStatus(current: unknown, next: unknown): PayrollGate {
  const frozen = canMutatePayrollRun(current);
  if (!frozen.ok) return frozen;
  if (!isPayrollRunStatus(next)) return { ok: false, reason: "Choose a valid payroll run status." };
  if (next === "paid") {
    return { ok: false, reason: "Use Mark paid to pay a run, so the payment is stamped and recorded." };
  }
  return { ok: true };
}

/**
 * Re-deciding a time card.
 *
 * Once a card's hours are inside a payroll run, its approval is load-bearing:
 * un-approving it would leave the run holding money for a card the platform no
 * longer considers approved, and nothing downstream would notice.
 */
export function canReviewTimeCard(isInPayrollRun: boolean): PayrollGate {
  if (isInPayrollRun) {
    return {
      ok: false,
      reason: "This time card is already part of a payroll run. Remove it from the run before changing its approval.",
    };
  }
  // Re-deciding a card that is NOT yet in a run stays allowed on purpose: that
  // is the window in which a mistake can still be corrected cheaply.
  return { ok: true };
}
