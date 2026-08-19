import { describe, expect, it } from "vitest";
import {
  clientCodePattern,
  formatClientProposalNumber,
  isValidClientCode,
  normalizeClientCode,
  suggestClientCode,
} from "./client-codes";

describe("normalizeClientCode / isValidClientCode", () => {
  it("trims but preserves case", () => {
    expect(normalizeClientCode("  Wondfo ")).toBe("Wondfo");
    expect(isValidClientCode("Wondfo")).toBe(true);
    expect(isValidClientCode(" se ")).toBe(true);
  });

  it("rejects everything outside 2-24 alphanumerics starting with a letter", () => {
    for (const bad of ["", "H", "1H", "H-N", "H N", "a".repeat(25), 12, null, undefined]) {
      expect(isValidClientCode(bad)).toBe(false);
    }
  });

  it("the pattern matches the migration's CHECK constraint", () => {
    expect(clientCodePattern.source).toBe("^[A-Za-z][A-Za-z0-9]{1,23}$");
  });
});

describe("formatClientProposalNumber", () => {
  it("zero-pads the sequence to three digits, keyed by year", () => {
    expect(formatClientProposalNumber("Wondfo", 1, 2026)).toBe("Wondfo-2026-001");
    expect(formatClientProposalNumber("se", 12, 2026)).toBe("se-2026-012");
  });

  it("grows past 999 instead of truncating", () => {
    // The failure mode this guards: a plain 3-char pad turning 1000 into "000"
    // and colliding with the first document of the year.
    expect(formatClientProposalNumber("Wondfo", 1000, 2026)).toBe("Wondfo-2026-1000");
  });

  it("never emits a zero or negative sequence", () => {
    expect(formatClientProposalNumber("Wondfo", 0, 2026)).toBe("Wondfo-2026-001");
    expect(formatClientProposalNumber("Wondfo", -3, 2026)).toBe("Wondfo-2026-001");
  });

  it("defaults to the current year when none is given", () => {
    const currentYear = new Date().getFullYear();
    expect(formatClientProposalNumber("Wondfo", 1)).toBe(`Wondfo-${currentYear}-001`);
  });
});

describe("suggestClientCode", () => {
  it("suggests the company's own name, not initials", () => {
    expect(suggestClientCode("Wondfo USA")).toBe("Wondfo");
    expect(suggestClientCode("Hunzinger")).toBe("Hunzinger");
  });

  it("falls back to the first two words joined on a collision", () => {
    expect(suggestClientCode("Staff Electric", ["Staff"])).toBe("StaffElectric");
  });

  it("keeps walking the ladder until an untaken candidate appears", () => {
    expect(suggestClientCode("Staff Electric", ["Staff", "StaffElectric"])).toBe("Staff2");
    expect(suggestClientCode("Staff Electric", ["Staff", "StaffElectric", "Staff2"])).toBe("Staff3");
  });

  it("strips punctuation and ignores words that don't start with a letter", () => {
    expect(suggestClientCode("hunzinger construction, inc.")).toBe("hunzinger");
    expect(suggestClientCode("42 Studios")).toBe("Studios");
  });

  it("returns empty when the name yields no candidate at all", () => {
    expect(suggestClientCode("")).toBe("");
    expect(suggestClientCode("42")).toBe("");
    expect(suggestClientCode(undefined)).toBe("");
  });

  it("never suggests a taken code regardless of its casing", () => {
    expect(suggestClientCode("Wondfo", ["wondfo"])).toBe("Wondfo2");
  });
});
