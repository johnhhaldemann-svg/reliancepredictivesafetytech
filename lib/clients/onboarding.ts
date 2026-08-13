import { checklistStatuses } from "@/lib/company-data";

/**
 * The rules governing when a checklist item counts as done, and when finishing
 * one is allowed to move the company's pipeline stage.
 *
 * Pure so they can be tested without a database. The write itself lives in the
 * Server Action (app/employee/clients/[id]/actions.ts), which is also where the
 * authorization and audit trail are.
 */

export type ChecklistStatus = (typeof checklistStatuses)[number];

/** Rejects a status that is not one of the six, before it reaches the database. */
export function isValidChecklistStatus(status: string): status is ChecklistStatus {
  return checklistStatuses.includes(status as ChecklistStatus);
}

/**
 * Whether an item is complete after a patch.
 *
 * "Complete" as a status always implies completion, so the flag and the status
 * cannot disagree — a row reading `status: "Complete", completed: false` would
 * be counted as outstanding by one screen and done by another. Any other status
 * leaves the flag to whatever the caller explicitly passed, falling back to
 * what the row already said.
 */
export function resolveChecklistCompletion(input: {
  nextStatus: string;
  patchCompleted?: boolean;
  currentCompleted?: boolean | null;
}): boolean {
  if (input.nextStatus === "Complete") return true;
  return input.patchCompleted ?? Boolean(input.currentCompleted);
}

/**
 * Whether finishing this item should advance the company's stage.
 *
 * Only the TRANSITION into completion counts. Re-saving a note on an item that
 * was already complete must not re-assert its stage — harmless today because
 * the advancer refuses to walk backwards, but it would start writing stage
 * changes and audit entries for edits that changed nothing.
 */
export function shouldAdvanceOnCompletion(
  wasCompleted: boolean | null | undefined,
  isCompleted: boolean,
): boolean {
  return isCompleted && !wasCompleted;
}
