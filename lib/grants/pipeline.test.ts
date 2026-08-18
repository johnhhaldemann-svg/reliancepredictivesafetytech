import { describe, expect, it } from "vitest";
import {
  daysUntil,
  deadlineUrgency,
  decidedGrantStatuses,
  grantStatusLabel,
  grantStatuses,
  groupGrantsByStatus,
  isDecidedGrant,
  isGrantStatus,
  isOpenGrant,
  openGrantStatuses,
  sortGrants,
  summariseGrants,
  type GrantRow,
} from "@/lib/grants/pipeline";

const NOW = new Date("2026-08-18T12:00:00.000Z");

function row(overrides: Partial<GrantRow> = {}): GrantRow {
  return {
    id: Math.random().toString(36).slice(2),
    name: "A grant",
    agency: null,
    sub_agency: null,
    status: "identified",
    fee_amount: null,
    fee_kind: null,
    fee_paid: false,
    award_amount: null,
    deadline: null,
    opens_on: null,
    next_action: null,
    next_action_due: null,
    ...overrides,
  };
}

describe("status vocabulary", () => {
  it("matches the nine statuses the database CHECK constraint allows", () => {
    expect([...grantStatuses]).toEqual([
      "identified",
      "researching",
      "inquiry_sent",
      "pre_registered",
      "application_submitted",
      "on_hold",
      "awarded",
      "declined",
      "not_eligible",
    ]);
  });

  it("labels every status", () => {
    for (const status of grantStatuses) {
      expect(grantStatusLabel(status)).not.toBe("Unknown status");
    }
  });

  it("says so rather than throwing when a status is not recognised", () => {
    expect(grantStatusLabel("invented")).toBe("Unknown status");
    expect(isGrantStatus("invented")).toBe(false);
    expect(isGrantStatus(null)).toBe(false);
  });

  it("splits open from decided, and on_hold is neither", () => {
    expect(isOpenGrant("researching")).toBe(true);
    expect(isOpenGrant("awarded")).toBe(false);
    expect(isDecidedGrant("declined")).toBe(true);
    expect(isDecidedGrant("identified")).toBe(false);
    expect(isOpenGrant("on_hold")).toBe(false);
    expect(isDecidedGrant("on_hold")).toBe(false);
  });

  it("keeps the three outcome statuses the database requires a reason for", () => {
    expect([...decidedGrantStatuses]).toEqual(["awarded", "declined", "not_eligible"]);
    for (const status of decidedGrantStatuses) {
      expect(openGrantStatuses).not.toContain(status);
    }
  });
});

describe("summariseGrants", () => {
  it("counts open and decided separately and leaves on_hold out of both", () => {
    const totals = summariseGrants([
      row({ status: "identified" }),
      row({ status: "application_submitted" }),
      row({ status: "on_hold" }),
      row({ status: "awarded", award_amount: "5000" }),
      row({ status: "not_eligible" }),
    ]);

    expect(totals.total).toBe(5);
    expect(totals.open).toBe(2);
    expect(totals.decided).toBe(2);
  });

  it("adds up only what was actually awarded", () => {
    const totals = summariseGrants([
      row({ status: "awarded", award_amount: "20000" }),
      row({ status: "declined", award_amount: "9999" }),
      row({ status: "identified", award_amount: "500" }),
    ]);

    expect(totals.awardedValue).toBe(20000);
  });

  it("separates fees already spent from fees still gating a live pursuit", () => {
    const totals = summariseGrants([
      row({ status: "application_submitted", fee_amount: "15", fee_kind: "application", fee_paid: true }),
      row({ status: "researching", fee_amount: "125", fee_kind: "membership", fee_paid: false }),
      row({ status: "declined", fee_amount: "50", fee_paid: false }),
    ]);

    expect(totals.feesPaid).toBe(15);
    // The declined row's unpaid fee is not outstanding — nobody will pay it.
    expect(totals.feesOutstanding).toBe(125);
  });

  it("totals what is on the table across live pursuits only", () => {
    const totals = summariseGrants([
      row({ status: "identified", award_amount: "20000" }),
      row({ status: "on_hold", award_amount: "500" }),
      row({ status: "declined", award_amount: "100000" }),
    ]);

    expect(totals.openOpportunityValue).toBe(20000);
  });

  it("treats a numeric string and a number alike, and a null as zero", () => {
    expect(summariseGrants([row({ status: "awarded", award_amount: 250 })]).awardedValue).toBe(250);
    expect(summariseGrants([row({ status: "awarded", award_amount: "250" })]).awardedValue).toBe(250);
    expect(summariseGrants([row({ status: "awarded", award_amount: null })]).awardedValue).toBe(0);
  });

  it("returns zeroes for an empty tracker instead of failing", () => {
    expect(summariseGrants([])).toEqual({
      total: 0,
      open: 0,
      decided: 0,
      awardedValue: 0,
      feesPaid: 0,
      feesOutstanding: 0,
      openOpportunityValue: 0,
    });
  });
});

describe("daysUntil and deadlineUrgency", () => {
  it("counts whole calendar days forward and backward from now", () => {
    expect(daysUntil("2026-08-25", NOW)).toBe(7);
    expect(daysUntil("2026-08-11", NOW)).toBe(-7);
  });

  it("returns null for a missing or unparseable date rather than a misleading zero", () => {
    expect(daysUntil(null, NOW)).toBeNull();
    expect(daysUntil("not-a-date", NOW)).toBeNull();
  });

  it("escalates as a live deadline approaches", () => {
    expect(deadlineUrgency(row({ status: "researching", deadline: "2026-08-20" }), NOW)?.tone).toBe("urgent");
    expect(deadlineUrgency(row({ status: "researching", deadline: "2026-09-05" }), NOW)?.tone).toBe("soon");
    expect(deadlineUrgency(row({ status: "researching", deadline: "2026-12-01" }), NOW)?.tone).toBe("later");
    expect(deadlineUrgency(row({ status: "researching", deadline: "2026-08-01" }), NOW)?.tone).toBe("past");
    expect(deadlineUrgency(row({ status: "researching", deadline: "2026-08-18" }), NOW)?.label).toBe("Closes today");
  });

  it("stays quiet about a decided pursuit — a passed deadline is history, not a problem", () => {
    expect(deadlineUrgency(row({ status: "declined", deadline: "2026-08-01" }), NOW)).toBeNull();
    expect(deadlineUrgency(row({ status: "awarded", deadline: "2026-08-01" }), NOW)).toBeNull();
  });

  it("stays quiet when there is no deadline at all", () => {
    expect(deadlineUrgency(row({ status: "researching", deadline: null }), NOW)).toBeNull();
  });
});

describe("ordering and grouping", () => {
  it("puts live pursuits before held, and held before decided", () => {
    const sorted = sortGrants([
      row({ status: "declined", name: "D" }),
      row({ status: "identified", name: "A" }),
      row({ status: "on_hold", name: "C" }),
      row({ status: "application_submitted", name: "B" }),
    ]);

    expect(sorted.map((r) => r.name)).toEqual(["A", "B", "C", "D"]);
  });

  it("breaks a same-status tie alphabetically", () => {
    const sorted = sortGrants([row({ status: "identified", name: "Zeta" }), row({ status: "identified", name: "Alpha" })]);

    expect(sorted.map((r) => r.name)).toEqual(["Alpha", "Zeta"]);
  });

  it("groups by status in pipeline order and omits empty statuses", () => {
    const groups = groupGrantsByStatus([
      row({ status: "awarded", name: "Won" }),
      row({ status: "identified", name: "New" }),
      row({ status: "identified", name: "Another" }),
    ]);

    expect(groups.map((g) => g.status)).toEqual(["identified", "awarded"]);
    expect(groups[0].rows.map((r) => r.name)).toEqual(["Another", "New"]);
  });

  it("returns nothing for an empty tracker", () => {
    expect(groupGrantsByStatus([])).toEqual([]);
    expect(sortGrants([])).toEqual([]);
  });
});
