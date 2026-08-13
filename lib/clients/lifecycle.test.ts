import { describe, expect, it } from "vitest";
import { lifecycleStages } from "@/lib/company-data";
import { isKnownStage, shouldAdvanceStage, stageRank } from "./lifecycle";

describe("stageRank", () => {
  it("orders the stages the way the pipeline runs", () => {
    expect(stageRank("Lead")).toBe(0);
    expect(stageRank("Proposal Sent")).toBeLessThan(stageRank("Signed / Won"));
    expect(stageRank("Signed / Won")).toBeLessThan(stageRank("Active Company"));
  });

  it("treats an unknown or empty stage as before everything", () => {
    expect(stageRank("Some Retired Stage")).toBe(-1);
    expect(stageRank("")).toBe(-1);
    expect(stageRank(null)).toBe(-1);
    expect(stageRank(undefined)).toBe(-1);
  });
});

describe("isKnownStage", () => {
  it("accepts every real stage and nothing else", () => {
    for (const stage of lifecycleStages) expect(isKnownStage(stage)).toBe(true);
    expect(isKnownStage("Signed / Wonk")).toBe(false);
    expect(isKnownStage(null)).toBe(false);
  });
});

describe("shouldAdvanceStage", () => {
  it("moves a deal forward", () => {
    expect(shouldAdvanceStage("Lead", "Proposal Sent")).toBe(true);
    expect(shouldAdvanceStage("Proposal Sent", "Signed / Won")).toBe(true);
  });

  // The rule the whole module exists for.
  it("never walks a deal backwards", () => {
    expect(shouldAdvanceStage("Signed / Won", "Proposal Sent")).toBe(false);
    expect(shouldAdvanceStage("Active Company", "Signed / Won")).toBe(false);
    expect(shouldAdvanceStage("Onboarding", "Signed / Won")).toBe(false);
  });

  it("declines a move to the stage the company is already in", () => {
    for (const stage of lifecycleStages) {
      expect(shouldAdvanceStage(stage, stage)).toBe(false);
    }
  });

  it("advances a company carrying an unrecognised stage to a real one", () => {
    expect(shouldAdvanceStage("Some Retired Stage", "Proposal Sent")).toBe(true);
    expect(shouldAdvanceStage("", "Lead")).toBe(true);
    expect(shouldAdvanceStage(null, "Signed / Won")).toBe(true);
  });

  // A typo must not blank out a live company's position in the pipeline.
  it("refuses a target that is not a real stage", () => {
    expect(shouldAdvanceStage("Lead", "Signed / Wonk")).toBe(false);
    expect(shouldAdvanceStage("Lead", "")).toBe(false);
  });

  /**
   * Equivalence with the hardcoded set this generalises. Acceptance previously
   * refused to advance when the company was in {Signed / Won, Onboarding,
   * Pilot / Setup, Active Company, Renewal / Expansion}; by rank those are
   * exactly the stages at or past Signed / Won, so the refactor cannot have
   * changed acceptance's behaviour for any stage.
   */
  it("reproduces the acceptance rule it replaced, stage for stage", () => {
    const previouslyBlocked = new Set([
      "Signed / Won",
      "Onboarding",
      "Pilot / Setup",
      "Active Company",
      "Renewal / Expansion",
    ]);

    for (const stage of lifecycleStages) {
      expect(shouldAdvanceStage(stage, "Signed / Won")).toBe(!previouslyBlocked.has(stage));
    }
  });
});
