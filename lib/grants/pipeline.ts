/**
 * The grant tracker's vocabulary and arithmetic.
 *
 * company_grant_opportunities has existed since 14 August with twelve real
 * rows, full RLS policies for read, insert and update, and eighteen check
 * constraints -- everything except a screen. This module is the missing half's
 * pure part: status order, labels, money, and deadline urgency, all testable
 * without a database.
 *
 * The status list mirrors the table's own CHECK constraint exactly. If the two
 * ever drift, a row the database accepts would render as "Unknown" here, so the
 * order below is the contract.
 */

export const grantStatuses = [
  "identified",
  "researching",
  "inquiry_sent",
  "pre_registered",
  "application_submitted",
  "on_hold",
  "awarded",
  "declined",
  "not_eligible",
] as const;

export type GrantStatus = (typeof grantStatuses)[number];

/** Statuses that mean the pursuit is still alive. */
export const openGrantStatuses: readonly GrantStatus[] = [
  "identified",
  "researching",
  "inquiry_sent",
  "pre_registered",
  "application_submitted",
];

/**
 * Statuses the database will not accept without an outcome_reason. Closing a
 * pursuit has to say why, so a later reader is never left guessing.
 */
export const decidedGrantStatuses: readonly GrantStatus[] = ["awarded", "declined", "not_eligible"];

const statusLabels: Record<GrantStatus, string> = {
  identified: "Identified",
  researching: "Researching",
  inquiry_sent: "Inquiry sent",
  pre_registered: "Pre-registered",
  application_submitted: "Application submitted",
  on_hold: "On hold",
  awarded: "Awarded",
  declined: "Declined",
  not_eligible: "Not eligible",
};

/** Tone per status. Never the only signal — every pill also carries its label. */
const statusTones: Record<GrantStatus, "open" | "active" | "hold" | "won" | "lost"> = {
  identified: "open",
  researching: "open",
  inquiry_sent: "active",
  pre_registered: "active",
  application_submitted: "active",
  on_hold: "hold",
  awarded: "won",
  declined: "lost",
  not_eligible: "lost",
};

export function isGrantStatus(value: unknown): value is GrantStatus {
  return typeof value === "string" && grantStatuses.includes(value as GrantStatus);
}

export function grantStatusLabel(status: string): string {
  return isGrantStatus(status) ? statusLabels[status] : "Unknown status";
}

export function grantStatusTone(status: string): string {
  return isGrantStatus(status) ? statusTones[status] : "hold";
}

export function isOpenGrant(status: string): boolean {
  return isGrantStatus(status) && openGrantStatuses.includes(status);
}

export function isDecidedGrant(status: string): boolean {
  return isGrantStatus(status) && decidedGrantStatuses.includes(status);
}

export type GrantRow = {
  id: string;
  name: string;
  agency: string | null;
  sub_agency: string | null;
  status: string;
  fee_amount: string | number | null;
  fee_kind: string | null;
  fee_paid: boolean;
  award_amount: string | number | null;
  deadline: string | null;
  opens_on: string | null;
  next_action: string | null;
  next_action_due: string | null;
};

function money(value: string | number | null | undefined): number {
  const n = typeof value === "string" ? Number(value) : (value ?? 0);

  return Number.isFinite(n) ? n : 0;
}

export type GrantTotals = {
  total: number;
  open: number;
  decided: number;
  awardedValue: number;
  /** Money already spent on fees, whether or not anything came back. */
  feesPaid: number;
  /** Fees a pursuit still has to pay before it can proceed. */
  feesOutstanding: number;
  /** What is on the table across every pursuit still alive. */
  openOpportunityValue: number;
};

export function summariseGrants(rows: GrantRow[]): GrantTotals {
  let open = 0;
  let decided = 0;
  let awardedValue = 0;
  let feesPaid = 0;
  let feesOutstanding = 0;
  let openOpportunityValue = 0;

  for (const row of rows) {
    const fee = money(row.fee_amount);
    const award = money(row.award_amount);

    if (isOpenGrant(row.status)) {
      open += 1;
      openOpportunityValue += award;
    }

    if (isDecidedGrant(row.status)) {
      decided += 1;
    }

    if (row.status === "awarded") {
      awardedValue += award;
    }

    if (row.fee_paid) {
      feesPaid += fee;
    } else if (fee > 0 && isOpenGrant(row.status)) {
      feesOutstanding += fee;
    }
  }

  return { total: rows.length, open, decided, awardedValue, feesPaid, feesOutstanding, openOpportunityValue };
}

/**
 * Days until a date, counted from `now`. Negative means it has passed. Returns
 * null for a missing or unparseable date rather than a misleading zero.
 */
export function daysUntil(date: string | null | undefined, now: Date): number | null {
  if (!date) {
    return null;
  }

  // Whole calendar days between two dates, not elapsed hours. Comparing an
  // end-of-day deadline against a mid-morning `now` made a date seven days out
  // measure 7.5 and round to eight, which reads as a day that does not exist.
  const target = new Date(`${date.slice(0, 10)}T00:00:00.000Z`);

  if (!Number.isFinite(target.getTime())) {
    return null;
  }

  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

  return Math.round((target.getTime() - today) / 86_400_000);
}

export type GrantUrgency = { tone: "past" | "urgent" | "soon" | "later"; label: string } | null;

/**
 * How loudly a deadline should read. Only open pursuits get an urgency: a
 * declined grant whose deadline has passed is history, not a problem.
 */
export function deadlineUrgency(row: Pick<GrantRow, "status" | "deadline">, now: Date): GrantUrgency {
  if (!isOpenGrant(row.status)) {
    return null;
  }

  const days = daysUntil(row.deadline, now);

  if (days === null) {
    return null;
  }

  if (days < 0) {
    return { tone: "past", label: `Closed ${Math.abs(days)}d ago` };
  }

  if (days <= 7) {
    return { tone: "urgent", label: days === 0 ? "Closes today" : `${days}d left` };
  }

  if (days <= 30) {
    return { tone: "soon", label: `${days}d left` };
  }

  return { tone: "later", label: `${days}d left` };
}

/** Pipeline order for display: live pursuits first, then held, then decided. */
export function sortGrants<T extends GrantRow>(rows: T[]): T[] {
  const rank = (status: string) => {
    const index = grantStatuses.indexOf(status as GrantStatus);

    return index === -1 ? grantStatuses.length : index;
  };

  return [...rows].sort((a, b) => rank(a.status) - rank(b.status) || a.name.localeCompare(b.name));
}

/** Rows grouped by status, in pipeline order, skipping statuses with nothing in them. */
export function groupGrantsByStatus<T extends GrantRow>(rows: T[]): { status: GrantStatus; label: string; rows: T[] }[] {
  return grantStatuses
    .map((status) => ({
      status,
      label: statusLabels[status],
      rows: rows.filter((row) => row.status === status).sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .filter((group) => group.rows.length > 0);
}
