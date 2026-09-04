import { describe, expect, it } from "vitest";
import {
  formatProposalLinkedInvoiceNumber,
  formatStandaloneInvoiceNumber,
  invoiceNumberNamesClient,
  parseProposalLinkedInvoiceNumber,
} from "./numbering";

describe("formatProposalLinkedInvoiceNumber", () => {
  it("hangs the invoice off its parent proposal, restarting at 01", () => {
    expect(formatProposalLinkedInvoiceNumber("Wondfo-2026-002", 1)).toBe("Wondfo-2026-002-01");
    expect(formatProposalLinkedInvoiceNumber("Wondfo-2026-002", 2)).toBe("Wondfo-2026-002-02");
    // A different proposal starts its own sequence at 01 — the whole point.
    expect(formatProposalLinkedInvoiceNumber("Wondfo-2026-003", 1)).toBe("Wondfo-2026-003-01");
  });

  it("grows past the pad width rather than truncating into a duplicate", () => {
    expect(formatProposalLinkedInvoiceNumber("Wondfo-2026-002", 9)).toBe("Wondfo-2026-002-09");
    expect(formatProposalLinkedInvoiceNumber("Wondfo-2026-002", 100)).toBe("Wondfo-2026-002-100");
  });

  it("returns null when there is no parent number to hang off", () => {
    expect(formatProposalLinkedInvoiceNumber(null, 1)).toBeNull();
    expect(formatProposalLinkedInvoiceNumber("   ", 1)).toBeNull();
    expect(formatProposalLinkedInvoiceNumber(undefined, 1)).toBeNull();
  });
});

describe("formatStandaloneInvoiceNumber", () => {
  it("uses the client code, the year and an INV infix", () => {
    expect(formatStandaloneInvoiceNumber("Wondfo", 1, 2026)).toBe("Wondfo-2026-INV-01");
    expect(formatStandaloneInvoiceNumber("Wondfo", 12, 2026)).toBe("Wondfo-2026-INV-12");
  });

  it("cannot collide with a proposal number for the same client and year", () => {
    expect(formatStandaloneInvoiceNumber("Wondfo", 1, 2026)).not.toBe("Wondfo-2026-001");
  });
});

describe("parseProposalLinkedInvoiceNumber", () => {
  it("splits a proposal-linked number back into its parts", () => {
    expect(parseProposalLinkedInvoiceNumber("Wondfo-2026-002-01")).toEqual({
      proposalNumber: "Wondfo-2026-002",
      seq: 1,
    });
  });

  it("rejects a standalone number, whose stem is not a proposal", () => {
    expect(parseProposalLinkedInvoiceNumber("Wondfo-2026-INV-07")).toBeNull();
    expect(parseProposalLinkedInvoiceNumber("WONDFOUSA-2026-INV-03")).toBeNull();
  });

  it("rejects anything that is not a number at all", () => {
    expect(parseProposalLinkedInvoiceNumber("Unnumbered draft")).toBeNull();
    expect(parseProposalLinkedInvoiceNumber(null)).toBeNull();
    expect(parseProposalLinkedInvoiceNumber(undefined)).toBeNull();
  });

  it("round-trips with the formatter", () => {
    const number = formatProposalLinkedInvoiceNumber("Wondfo-2026-002", 3)!;
    expect(parseProposalLinkedInvoiceNumber(number)).toEqual({ proposalNumber: "Wondfo-2026-002", seq: 3 });
  });
});

describe("invoiceNumberNamesClient", () => {
  it("accepts a number carrying the client's own code", () => {
    expect(invoiceNumberNamesClient("Wondfo-2026-002-01", "Wondfo")).toBe(true);
    expect(invoiceNumberNamesClient("Wondfo-2026-INV-01", "Wondfo")).toBe(true);
  });

  it("is case-insensitive, since codes keep the case they were typed in", () => {
    expect(invoiceNumberNamesClient("wondfo-2026-002-01", "Wondfo")).toBe(true);
  });

  it("rejects the global RPS fallback — the defect that unlinked the two in August", () => {
    expect(invoiceNumberNamesClient("RPS-2026-0011-01", "Wondfo")).toBe(false);
  });

  it("rejects another client's prefix", () => {
    expect(invoiceNumberNamesClient("Hunzinger-2026-001-01", "Wondfo")).toBe(false);
  });

  it("rejects when the client has no code to name", () => {
    expect(invoiceNumberNamesClient("Wondfo-2026-002-01", "")).toBe(false);
    expect(invoiceNumberNamesClient("Wondfo-2026-002-01", "   ")).toBe(false);
  });

  it("does not accept a code that is merely a prefix of the real one", () => {
    // "Wond" must not match "Wondfo-..." — the separator is part of the test.
    expect(invoiceNumberNamesClient("Wondfo-2026-002-01", "Wond")).toBe(false);
  });
});
