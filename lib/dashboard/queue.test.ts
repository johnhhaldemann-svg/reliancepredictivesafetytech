import { describe, expect, it } from "vitest";
import type { CommandPriorityItem } from "@/lib/ai/command-context";
import {
  collapseQueue,
  collapseThreshold,
  countByWorkspace,
  countQueueByFilter,
  filterQueue,
  matchesQueueFilter,
  parseQueueFilter,
  pickHeadline,
  workspaceForItem,
} from "@/lib/dashboard/queue";

const NOW = new Date("2026-08-18T12:00:00.000Z");

function item(overrides: Partial<CommandPriorityItem> = {}): CommandPriorityItem {
  return {
    title: "An item",
    label: "Label",
    href: "/employee",
    actionHref: "/employee",
    priority: "medium",
    detail: "detail",
    owner: null,
    dueDate: null,
    status: "open",
    sourceLabel: "Operations",
    sourceType: "operations",
    sourceId: Math.random().toString(36).slice(2),
    reviewRequired: false,
    ...overrides,
  };
}

describe("parseQueueFilter", () => {
  it("accepts the four filters", () => {
    for (const f of ["all", "mine", "review", "risk"] as const) {
      expect(parseQueueFilter(f)).toBe(f);
    }
  });

  it("falls back to all for junk", () => {
    expect(parseQueueFilter("everything")).toBe("all");
    expect(parseQueueFilter(null)).toBe("all");
    expect(parseQueueFilter(undefined)).toBe("all");
  });
});

describe("matchesQueueFilter", () => {
  it("all takes everything", () => {
    expect(matchesQueueFilter(item(), "all", "John Haldemann", NOW)).toBe(true);
  });

  it("review takes only what is flagged for review", () => {
    expect(matchesQueueFilter(item({ reviewRequired: true }), "review", null, NOW)).toBe(true);
    expect(matchesQueueFilter(item({ reviewRequired: false }), "review", null, NOW)).toBe(false);
  });

  it("risk takes critical, high, or anything past its due date", () => {
    expect(matchesQueueFilter(item({ priority: "critical" }), "risk", null, NOW)).toBe(true);
    expect(matchesQueueFilter(item({ priority: "high" }), "risk", null, NOW)).toBe(true);
    expect(matchesQueueFilter(item({ priority: "low", dueDate: "2026-08-12" }), "risk", null, NOW)).toBe(true);
    expect(matchesQueueFilter(item({ priority: "low", dueDate: "2026-09-30" }), "risk", null, NOW)).toBe(false);
    expect(matchesQueueFilter(item({ priority: "low", dueDate: null }), "risk", null, NOW)).toBe(false);
  });

  it("treats the due date as end of day, so today is not yet late", () => {
    expect(matchesQueueFilter(item({ priority: "low", dueDate: "2026-08-18" }), "risk", null, NOW)).toBe(false);
  });

  it("mine matches the owner regardless of case and surrounding space", () => {
    expect(matchesQueueFilter(item({ owner: "John Haldemann" }), "mine", "john haldemann", NOW)).toBe(true);
    expect(matchesQueueFilter(item({ owner: "  John Haldemann " }), "mine", "John Haldemann", NOW)).toBe(true);
  });

  it("mine excludes unowned work rather than showing it to everyone", () => {
    expect(matchesQueueFilter(item({ owner: null }), "mine", "John Haldemann", NOW)).toBe(false);
    expect(matchesQueueFilter(item({ owner: "Scott Wendt" }), "mine", "John Haldemann", NOW)).toBe(false);
    expect(matchesQueueFilter(item({ owner: "John Haldemann" }), "mine", null, NOW)).toBe(false);
  });
});

describe("countQueueByFilter", () => {
  it("counts each bucket independently, and all is the total", () => {
    const items = [
      item({ priority: "critical", owner: "John Haldemann" }),
      item({ reviewRequired: true }),
      item({ priority: "low", dueDate: "2026-08-01" }),
      item({ priority: "low" }),
    ];
    const counts = countQueueByFilter(items, "John Haldemann", NOW);

    expect(counts.all).toBe(4);
    expect(counts.mine).toBe(1);
    expect(counts.review).toBe(1);
    expect(counts.risk).toBe(2);
  });

  it("reports zeroes on an empty queue instead of failing", () => {
    const counts = countQueueByFilter([], null, NOW);
    expect(counts).toEqual({ all: 0, mine: 0, review: 0, risk: 0 });
  });
});

describe("collapseQueue", () => {
  it("folds a repetitive batch into one row that still reports its true count", () => {
    const states = Array.from({ length: 50 }, (_, i) =>
      item({ sourceType: "state_compliance", status: "needs_review", title: `State ${i}` }),
    );
    const groups = collapseQueue(states);

    expect(groups).toHaveLength(1);
    expect(groups[0].count).toBe(50);
    expect(groups[0].folded).toHaveLength(49);
  });

  it("leaves a small set as individual rows", () => {
    const few = Array.from({ length: collapseThreshold - 1 }, (_, i) =>
      item({ sourceType: "proposal", status: "in_review", title: `Proposal ${i}` }),
    );

    expect(collapseQueue(few)).toHaveLength(collapseThreshold - 1);
  });

  it("does not fold two different situations that share a table", () => {
    const cards = [
      ...Array.from({ length: 5 }, () => item({ sourceType: "time_card", status: "submitted" })),
      ...Array.from({ length: 5 }, () => item({ sourceType: "time_card", status: "rejected" })),
    ];
    const groups = collapseQueue(cards);

    expect(groups).toHaveLength(2);
    expect(groups.every((g) => g.count === 5)).toBe(true);
  });

  it("leads each group with its most urgent member", () => {
    const bucket = [
      item({ sourceType: "ops", status: "open", priority: "low", title: "Low" }),
      item({ sourceType: "ops", status: "open", priority: "critical", title: "Critical" }),
      item({ sourceType: "ops", status: "open", priority: "medium", title: "Medium" }),
      item({ sourceType: "ops", status: "open", priority: "high", title: "High" }),
    ];

    expect(collapseQueue(bucket)[0].lead.title).toBe("Critical");
  });

  it("returns nothing for an empty queue", () => {
    expect(collapseQueue([])).toEqual([]);
  });
});

describe("pickHeadline", () => {
  it("names the most urgent item", () => {
    const items = [
      item({ priority: "medium", title: "Medium" }),
      item({ priority: "critical", title: "Critical" }),
      item({ priority: "high", title: "High" }),
    ];

    expect(pickHeadline(items)?.title).toBe("Critical");
  });

  it("breaks a priority tie on the soonest due date", () => {
    const items = [
      item({ priority: "high", dueDate: "2026-09-01", title: "Later" }),
      item({ priority: "high", dueDate: "2026-08-12", title: "Sooner" }),
    ];

    expect(pickHeadline(items)?.title).toBe("Sooner");
  });

  it("prefers an item with a deadline over one without", () => {
    const items = [
      item({ priority: "high", dueDate: null, title: "No date" }),
      item({ priority: "high", dueDate: "2026-08-30", title: "Dated" }),
    ];

    expect(pickHeadline(items)?.title).toBe("Dated");
  });

  it("ranks an unrecognised priority last rather than first", () => {
    const items = [
      item({ priority: "sideways" as CommandPriorityItem["priority"], title: "Junk" }),
      item({ priority: "low", title: "Low" }),
    ];

    expect(pickHeadline(items)?.title).toBe("Low");
  });

  it("returns null on an empty queue so the card can be omitted", () => {
    expect(pickHeadline([])).toBeNull();
  });
});

describe("workspaceForItem and countByWorkspace", () => {
  it("routes a source label to a workspace", () => {
    expect(workspaceForItem(item({ sourceLabel: "Commercial" }))).toBe("Revenue");
    expect(workspaceForItem(item({ sourceLabel: "Finance" }))).toBe("Revenue");
    expect(workspaceForItem(item({ sourceLabel: "People / HR" }))).toBe("People");
    expect(workspaceForItem(item({ sourceLabel: "Legal" }))).toBe("Governance");
    expect(workspaceForItem(item({ sourceLabel: "Website" }))).toBe("Platform");
  });

  it("falls back to Operations for anything unmapped", () => {
    expect(workspaceForItem(item({ sourceLabel: "Something new" }))).toBe("Operations");
    expect(workspaceForItem(item({ sourceLabel: "" }))).toBe("Operations");
  });

  it("tallies by workspace, busiest first", () => {
    const counts = countByWorkspace([
      item({ sourceLabel: "Commercial" }),
      item({ sourceLabel: "Finance" }),
      item({ sourceLabel: "People / HR" }),
    ]);

    expect(counts[0]).toEqual({ workspace: "Revenue", count: 2 });
    expect(counts[1]).toEqual({ workspace: "People", count: 1 });
  });
});

describe("filterQueue", () => {
  it("is consistent with matchesQueueFilter", () => {
    const items = [
      item({ priority: "critical" }),
      item({ reviewRequired: true }),
      item({ owner: "John Haldemann" }),
    ];

    for (const f of ["all", "mine", "review", "risk"] as const) {
      expect(filterQueue(items, f, "John Haldemann", NOW)).toEqual(
        items.filter((i) => matchesQueueFilter(i, f, "John Haldemann", NOW)),
      );
    }
  });
});
