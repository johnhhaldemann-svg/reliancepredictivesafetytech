import type { CommandPriorityItem } from "@/lib/ai/command-context";

/**
 * Turning the command snapshot into one queue.
 *
 * The classic dashboard renders the same rows four times — Needs Attention,
 * My Work, Review Queue, and Risk / Due Soon are four panels over one dataset,
 * so a single overdue invoice appears three times on one screen. These
 * functions produce ONE list with filters over it instead, and collapse the
 * repetitive batches (fifty state compliance reviews) into a single row that
 * still reports its true count.
 *
 * Pure — every function takes what it needs, including `now`, so behaviour at
 * a date boundary is testable rather than dependent on when the suite runs.
 */

export const queueFilters = ["all", "mine", "review", "risk"] as const;

export type QueueFilter = (typeof queueFilters)[number];

export function parseQueueFilter(raw: string | null | undefined): QueueFilter {
  return typeof raw === "string" && queueFilters.includes(raw as QueueFilter) ? (raw as QueueFilter) : "all";
}

const priorityRank: Record<CommandPriorityItem["priority"], number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

/** Ranks an unrecognised priority last rather than first, so junk never leads the queue. */
function rankOf(priority: string): number {
  return priority in priorityRank ? priorityRank[priority as CommandPriorityItem["priority"]] : priorityRank.low + 1;
}

function isOverdue(item: CommandPriorityItem, now: Date): boolean {
  if (!item.dueDate) {
    return false;
  }

  const due = new Date(`${item.dueDate.slice(0, 10)}T23:59:59.999Z`);

  return Number.isFinite(due.getTime()) && due.getTime() < now.getTime();
}

/**
 * Does this row belong in this filter.
 *
 * `mine` compares against the viewer's display name because that is what the
 * snapshot carries in `owner`. An unowned item is nobody's, so it is excluded
 * from `mine` rather than shown to everyone.
 */
export function matchesQueueFilter(
  item: CommandPriorityItem,
  filter: QueueFilter,
  viewerName: string | null,
  now: Date,
): boolean {
  if (filter === "all") {
    return true;
  }

  if (filter === "review") {
    return item.reviewRequired;
  }

  if (filter === "risk") {
    return item.priority === "critical" || item.priority === "high" || isOverdue(item, now);
  }

  if (!viewerName || !item.owner) {
    return false;
  }

  return item.owner.trim().toLowerCase() === viewerName.trim().toLowerCase();
}

export function filterQueue(
  items: CommandPriorityItem[],
  filter: QueueFilter,
  viewerName: string | null,
  now: Date,
): CommandPriorityItem[] {
  return items.filter((item) => matchesQueueFilter(item, filter, viewerName, now));
}

export function countQueueByFilter(
  items: CommandPriorityItem[],
  viewerName: string | null,
  now: Date,
): Record<QueueFilter, number> {
  return {
    all: items.length,
    mine: filterQueue(items, "mine", viewerName, now).length,
    review: filterQueue(items, "review", viewerName, now).length,
    risk: filterQueue(items, "risk", viewerName, now).length,
  };
}

export type QueueGroup = {
  /** Stable key for React. */
  key: string;
  /** The row actually rendered — the highest-priority member of the group. */
  lead: CommandPriorityItem;
  /** How many rows this one stands for. 1 means it stands only for itself. */
  count: number;
  /** The rows folded behind the lead, so the UI can expand without refetching. */
  folded: CommandPriorityItem[];
};

/**
 * Rows below this many identical-kind items are shown individually. At or above
 * it they collapse to one row. Four is low enough to catch the fifty state
 * compliance reviews and high enough that three unrelated proposals still each
 * get their own line.
 */
export const collapseThreshold = 4;

function sortByUrgency(a: CommandPriorityItem, b: CommandPriorityItem): number {
  const byPriority = rankOf(a.priority) - rankOf(b.priority);

  if (byPriority !== 0) {
    return byPriority;
  }

  if (a.dueDate && b.dueDate) {
    return a.dueDate.localeCompare(b.dueDate);
  }

  // An item with a due date outranks one without: a deadline is information.
  if (a.dueDate) return -1;
  if (b.dueDate) return 1;

  return a.title.localeCompare(b.title);
}

/**
 * Collapse repetitive batches, keep everything else.
 *
 * Grouping is by source type AND status, so "fifty states needing review"
 * folds but "a rejected time card and a submitted time card" do not — those
 * are different situations that happen to share a table.
 */
export function collapseQueue(items: CommandPriorityItem[]): QueueGroup[] {
  const buckets = new Map<string, CommandPriorityItem[]>();
  const order: string[] = [];

  for (const item of items) {
    const key = `${item.sourceType}::${item.status}`;

    if (!buckets.has(key)) {
      buckets.set(key, []);
      order.push(key);
    }

    buckets.get(key)!.push(item);
  }

  const groups: QueueGroup[] = [];

  for (const key of order) {
    const bucket = [...buckets.get(key)!].sort(sortByUrgency);

    if (bucket.length >= collapseThreshold) {
      groups.push({ key, lead: bucket[0], count: bucket.length, folded: bucket.slice(1) });
      continue;
    }

    for (const item of bucket) {
      groups.push({ key: `${key}::${item.sourceId}`, lead: item, count: 1, folded: [] });
    }
  }

  return groups.sort((a, b) => sortByUrgency(a.lead, b.lead));
}

/**
 * The single item the "do this first" card names.
 *
 * Highest priority, then soonest due. Returns null on an empty queue so the
 * card can be omitted entirely rather than rendered empty.
 */
export function pickHeadline(items: CommandPriorityItem[]): CommandPriorityItem | null {
  if (items.length === 0) {
    return null;
  }

  return [...items].sort(sortByUrgency)[0];
}

/** Which workspace a queue row belongs to, for the "across the platform" panel. */
export function workspaceForItem(item: CommandPriorityItem): string {
  const label = (item.sourceLabel ?? "").toLowerCase();

  if (label.includes("commercial") || label.includes("finance") || label.includes("sales")) {
    return "Revenue";
  }

  if (label.includes("people") || label.includes("hr") || label.includes("payroll")) {
    return "People";
  }

  if (label.includes("legal") || label.includes("document") || label.includes("compliance")) {
    return "Governance";
  }

  if (label.includes("platform") || label.includes("website") || label.includes("workflow")) {
    return "Platform";
  }

  return "Operations";
}

export function countByWorkspace(items: CommandPriorityItem[]): { workspace: string; count: number }[] {
  const tally = new Map<string, number>();

  for (const item of items) {
    const workspace = workspaceForItem(item);
    tally.set(workspace, (tally.get(workspace) ?? 0) + 1);
  }

  return [...tally.entries()]
    .map(([workspace, count]) => ({ workspace, count }))
    .sort((a, b) => b.count - a.count || a.workspace.localeCompare(b.workspace));
}
