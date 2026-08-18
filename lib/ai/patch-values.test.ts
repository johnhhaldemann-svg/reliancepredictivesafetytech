import { describe, expect, it } from "vitest";
import { lifecycleStages } from "@/lib/company-data";
import { dropDisallowedPatchValues, isAllowedPatchValue } from "@/lib/ai/patch-values";

describe("isAllowedPatchValue", () => {
  it("accepts every canonical lifecycle stage", () => {
    for (const stage of lifecycleStages) {
      expect(isAllowedPatchValue("company_clients", "lifecycle_stage", stage)).toBe(true);
    }
  });

  it("refuses the stage that actually leaked into the record", () => {
    expect(isAllowedPatchValue("company_clients", "lifecycle_stage", "Invoicing")).toBe(false);
  });

  it("refuses a near miss rather than guessing what was meant", () => {
    expect(isAllowedPatchValue("company_clients", "lifecycle_stage", "signed / won")).toBe(false);
    expect(isAllowedPatchValue("company_clients", "lifecycle_stage", " Lead ")).toBe(false);
    expect(isAllowedPatchValue("company_clients", "lifecycle_stage", "")).toBe(false);
  });

  it("refuses a non-string where a stage is expected", () => {
    expect(isAllowedPatchValue("company_clients", "lifecycle_stage", null)).toBe(false);
    expect(isAllowedPatchValue("company_clients", "lifecycle_stage", 3)).toBe(false);
    expect(isAllowedPatchValue("company_clients", "lifecycle_stage", ["Lead"])).toBe(false);
  });

  it("leaves a column with no declared enum alone", () => {
    expect(isAllowedPatchValue("company_clients", "notes", "anything at all")).toBe(true);
    expect(isAllowedPatchValue("company_clients", "owner", null)).toBe(true);
  });

  it("leaves a table with no declared enum alone", () => {
    expect(isAllowedPatchValue("company_legal_issues", "status", "whatever")).toBe(true);
  });
});

describe("dropDisallowedPatchValues", () => {
  it("keeps a wholly valid patch intact", () => {
    const result = dropDisallowedPatchValues("company_clients", {
      lifecycle_stage: "Proposal Sent",
      owner: "Scott Wendt",
    });

    expect(result.patch).toEqual({ lifecycle_stage: "Proposal Sent", owner: "Scott Wendt" });
    expect(result.dropped).toEqual([]);
  });

  it("drops only the bad column and applies the rest", () => {
    const result = dropDisallowedPatchValues("company_clients", {
      lifecycle_stage: "Invoicing",
      owner: "Scott Wendt",
      notes: "Renewal call booked",
    });

    expect(result.patch).toEqual({ owner: "Scott Wendt", notes: "Renewal call booked" });
    expect(result.dropped).toEqual(["lifecycle_stage"]);
  });

  it("returns an empty patch when the only column proposed is refused", () => {
    const result = dropDisallowedPatchValues("company_clients", { lifecycle_stage: "Invoicing" });

    expect(result.patch).toEqual({});
    expect(result.dropped).toEqual(["lifecycle_stage"]);
  });

  it("does not mutate the patch it was given", () => {
    const input = { lifecycle_stage: "Invoicing", owner: "Scott Wendt" };
    dropDisallowedPatchValues("company_clients", input);

    expect(input).toEqual({ lifecycle_stage: "Invoicing", owner: "Scott Wendt" });
  });
});
