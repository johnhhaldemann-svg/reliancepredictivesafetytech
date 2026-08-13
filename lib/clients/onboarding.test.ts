import { describe, expect, it } from "vitest";
import { checklistStatuses } from "@/lib/company-data";
import {
  isValidChecklistStatus,
  resolveChecklistCompletion,
  shouldAdvanceOnCompletion,
} from "./onboarding";

describe("isValidChecklistStatus", () => {
  it("accepts every real status", () => {
    for (const status of checklistStatuses) expect(isValidChecklistStatus(status)).toBe(true);
  });

  it("rejects anything else, so it never reaches the database", () => {
    expect(isValidChecklistStatus("Done")).toBe(false);
    expect(isValidChecklistStatus("complete")).toBe(false);
    expect(isValidChecklistStatus("")).toBe(false);
  });
});

describe("resolveChecklistCompletion", () => {
  it("treats the Complete status as completion regardless of the flag", () => {
    expect(resolveChecklistCompletion({ nextStatus: "Complete", currentCompleted: false })).toBe(true);
    // The flag cannot contradict the status — one screen would call the item
    // outstanding while another called it done.
    expect(resolveChecklistCompletion({ nextStatus: "Complete", patchCompleted: false })).toBe(true);
  });

  it("honours an explicit flag on any other status", () => {
    expect(resolveChecklistCompletion({ nextStatus: "In Review", patchCompleted: true })).toBe(true);
    expect(resolveChecklistCompletion({ nextStatus: "Blocked", patchCompleted: false })).toBe(false);
  });

  it("falls back to what the row already said", () => {
    expect(resolveChecklistCompletion({ nextStatus: "Draft", currentCompleted: true })).toBe(true);
    expect(resolveChecklistCompletion({ nextStatus: "Draft", currentCompleted: false })).toBe(false);
    expect(resolveChecklistCompletion({ nextStatus: "Draft", currentCompleted: null })).toBe(false);
  });
});

describe("shouldAdvanceOnCompletion", () => {
  it("advances on the transition into completion", () => {
    expect(shouldAdvanceOnCompletion(false, true)).toBe(true);
    expect(shouldAdvanceOnCompletion(null, true)).toBe(true);
    expect(shouldAdvanceOnCompletion(undefined, true)).toBe(true);
  });

  // Editing a note on a finished item is not a second completion.
  it("does not re-advance an item that was already complete", () => {
    expect(shouldAdvanceOnCompletion(true, true)).toBe(false);
  });

  it("does not advance when the item is not complete", () => {
    expect(shouldAdvanceOnCompletion(false, false)).toBe(false);
    expect(shouldAdvanceOnCompletion(true, false)).toBe(false);
  });
});
