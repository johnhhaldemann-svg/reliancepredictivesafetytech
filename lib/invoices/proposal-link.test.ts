import { describe, expect, it } from "vitest";
import type { InvoiceRow } from "@/lib/invoices/invoice";
import {
  billedForProposal,
  invoicesByProposal,
  isWonProposal,
  proposalLabel,
  proposalsReadyToInvoice,
  type ProposalRow,
} from "@/lib/invoices/proposal-link";

type Inv = InvoiceRow & { proposal_id: string | null };

function inv(o: Partial<Inv> = {}): Inv {
  return {
    id: Math.random().toString(36).slice(2),
    invoice_number: "INV-1",
    status: "issued",
    kind: "full",
    issue_date: "2026-08-01",
    due_date: "2026-08-31",
    currency: "USD",
    subtotal: "100",
    tax_amount: "0",
    total: "100",
    proposal_id: null,
    ...o,
  };
}

function prop(o: Partial<ProposalRow> = {}): ProposalRow {
  return { id: "p1", client_id: "c1", title: "A proposal", status: "sent", proposal_number: "BD-01", accepted_at: null, ...o };
}

describe("isWonProposal", () => {
  it("trusts the acceptance timestamp over the workflow label", () => {
    expect(isWonProposal(prop({ accepted_at: "2026-08-10T00:00:00Z", status: "sent" }))).toBe(true);
  });

  it("also accepts an explicit accepted status", () => {
    expect(isWonProposal(prop({ status: "accepted" }))).toBe(true);
  });

  it("does not treat a sent or draft proposal as won", () => {
    expect(isWonProposal(prop({ status: "sent" }))).toBe(false);
    expect(isWonProposal(prop({ status: "draft" }))).toBe(false);
    expect(isWonProposal(prop({ status: "declined" }))).toBe(false);
  });
});

describe("invoicesByProposal", () => {
  it("groups by proposal and ignores invoices with no proposal", () => {
    const map = invoicesByProposal([inv({ proposal_id: "p1" }), inv({ proposal_id: "p1" }), inv({ proposal_id: null })]);

    expect(map.get("p1")).toHaveLength(2);
    expect(map.size).toBe(1);
  });

  it("returns an empty map for no invoices", () => {
    expect(invoicesByProposal([]).size).toBe(0);
  });
});

describe("billedForProposal", () => {
  it("splits billed into what is owed and what came in", () => {
    const r = billedForProposal([
      inv({ status: "issued", total: "300" }),
      inv({ status: "paid", total: "700" }),
    ]);

    expect(r).toEqual({ billed: 1000, outstanding: 300, collected: 700 });
  });

  it("excludes a voided invoice entirely — it neither owes nor collects", () => {
    const r = billedForProposal([inv({ status: "void", total: "5000" }), inv({ status: "paid", total: "100" })]);

    expect(r).toEqual({ billed: 100, outstanding: 0, collected: 100 });
  });

  it("counts a draft as billed but not owed, since it has not been sent", () => {
    const r = billedForProposal([inv({ status: "draft", total: "250" })]);

    expect(r).toEqual({ billed: 250, outstanding: 0, collected: 0 });
  });

  it("returns zeroes for nothing raised", () => {
    expect(billedForProposal([])).toEqual({ billed: 0, outstanding: 0, collected: 0 });
  });
});

describe("proposalsReadyToInvoice", () => {
  it("finds a won proposal that nobody has billed", () => {
    const ready = proposalsReadyToInvoice([prop({ id: "p1", accepted_at: "2026-08-10T00:00:00Z" })], []);

    expect(ready).toHaveLength(1);
    expect(ready[0].proposal.id).toBe("p1");
    expect(ready[0].voidedOnly).toBe(false);
  });

  it("leaves out a won proposal that already has a live invoice", () => {
    const ready = proposalsReadyToInvoice(
      [prop({ id: "p1", accepted_at: "2026-08-10T00:00:00Z" })],
      [inv({ proposal_id: "p1", status: "issued" })],
    );

    expect(ready).toEqual([]);
  });

  it("flags a won proposal whose only invoice was voided, because that still needs a decision", () => {
    const ready = proposalsReadyToInvoice(
      [prop({ id: "p1", accepted_at: "2026-08-10T00:00:00Z" })],
      [inv({ proposal_id: "p1", status: "void" })],
    );

    expect(ready).toHaveLength(1);
    expect(ready[0].voidedOnly).toBe(true);
  });

  it("counts a draft invoice as billed, so a drafted-but-unsent bill is not reported twice", () => {
    const ready = proposalsReadyToInvoice(
      [prop({ id: "p1", accepted_at: "2026-08-10T00:00:00Z" })],
      [inv({ proposal_id: "p1", status: "draft" })],
    );

    expect(ready).toEqual([]);
  });

  it("ignores proposals that were never won", () => {
    expect(proposalsReadyToInvoice([prop({ status: "sent" }), prop({ id: "p2", status: "draft" })], [])).toEqual([]);
  });

  it("returns nothing when there are no proposals at all", () => {
    expect(proposalsReadyToInvoice([], [])).toEqual([]);
  });
});

describe("proposalLabel", () => {
  it("prefers the number, then the title, then says it is untitled", () => {
    expect(proposalLabel(prop({ proposal_number: "BD-01", title: "Anything" }))).toBe("BD-01");
    expect(proposalLabel(prop({ proposal_number: null, title: "Safety programme" }))).toBe("Safety programme");
    expect(proposalLabel(prop({ proposal_number: null, title: null }))).toBe("Untitled proposal");
  });
});
