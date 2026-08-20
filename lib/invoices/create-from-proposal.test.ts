import { describe, expect, it } from "vitest";
import { amountForKind, buildFullLines, qtyBasisFor } from "@/lib/invoices/create-from-proposal";
import type { ProposalLineItem, ProposalTotals } from "@/lib/proposals/pricing";

function line(o: Partial<ProposalLineItem> = {}): ProposalLineItem {
  return { source: "service", key: "", name: "Line", desc: "", unit: "", qty: 1, price: 0, amount: 0, ...o };
}

function totals(o: Partial<ProposalTotals> = {}): ProposalTotals {
  return { lineItems: [], subtotal: 0, discount: 0, tax: 0, total: 0, deposit: 0, ...o };
}

describe("amountForKind — what a generated invoice bills, per kind", () => {
  const totals = { total: 1000, deposit: 250 };

  it("bills the whole total for 'full'", () => {
    expect(amountForKind("full", totals, 0)).toBe(1000);
  });

  it("bills just the deposit for 'deposit'", () => {
    expect(amountForKind("deposit", totals, 0)).toBe(250);
  });

  it("bills total minus deposit for 'balance'", () => {
    expect(amountForKind("balance", totals, 0)).toBe(750);
  });

  it("falls back to the stored proposal_value for 'full' when there is no saved fee table", () => {
    expect(amountForKind("full", null, 1500)).toBe(1500);
  });

  it("has nothing to bill for 'deposit' or 'balance' without a saved fee table", () => {
    expect(amountForKind("deposit", null, 1500)).toBe(0);
    expect(amountForKind("balance", null, 1500)).toBe(0);
  });

  it("has no balance left once the deposit already covers the total", () => {
    expect(amountForKind("balance", { total: 1000, deposit: 1000 }, 0)).toBe(0);
  });
});

describe("qtyBasisFor — picks a basis that keeps a later edit's math consistent", () => {
  it("uses flat when quantity is 1, regardless of unit", () => {
    expect(qtyBasisFor("Session", 1)).toBe("flat");
    expect(qtyBasisFor("", 1)).toBe("flat");
  });

  it("matches hour and session units by name", () => {
    expect(qtyBasisFor("Hour", 3)).toBe("hour");
    expect(qtyBasisFor("Session", 2)).toBe("session");
  });

  it("falls back to a multiplying basis for any other per-unit count", () => {
    expect(qtyBasisFor("Person", 6)).toBe("attendee");
    expect(qtyBasisFor("Site", 4)).toBe("attendee");
  });
});

describe("buildFullLines — itemizes a full invoice from the proposal's own fee table", () => {
  it("emits one invoice line per proposal line item, not a lump sum", () => {
    const t = totals({
      lineItems: [
        line({ name: "First Aid / CPR / AED Training", unit: "Session", qty: 1, price: 1250, amount: 1250 }),
        line({ name: "Bloodborne Pathogens Training", unit: "Session", qty: 1, price: 250, amount: 250 }),
      ],
      subtotal: 1500,
      tax: 0,
      total: 1500,
    });

    const result = buildFullLines(t, "RPS-2026-0011 — Wondfo USA");

    expect(result.lines).toHaveLength(2);
    expect(result.lines[0].description).toBe("First Aid / CPR / AED Training");
    expect(result.lines[0].line_total).toBe(1250);
    expect(result.lines[1].description).toBe("Bloodborne Pathogens Training");
    expect(result.lines[1].line_total).toBe(250);
    expect(result.subtotal).toBe(1500);
  });

  it("scales every line down by the discount, since a negative discount line is not possible (line_total CHECK >= 0)", () => {
    const t = totals({
      lineItems: [
        line({ name: "A", unit: "Session", qty: 1, price: 800, amount: 800 }),
        line({ name: "B", unit: "Session", qty: 1, price: 200, amount: 200 }),
      ],
      subtotal: 1000,
      discount: 100, // 10% off
      tax: 0,
      total: 900,
    });

    const result = buildFullLines(t, "ref");

    expect(result.lines[0].line_total).toBe(720); // 800 * 0.9
    expect(result.lines[1].line_total).toBe(180); // 200 * 0.9
    expect(result.subtotal).toBe(900);
  });

  it("keeps tax as a header figure rather than folding it into the lines", () => {
    const t = totals({
      lineItems: [line({ name: "A", unit: "Session", qty: 1, price: 1000, amount: 1000 })],
      subtotal: 1000,
      tax: 80,
      total: 1080,
    });

    const result = buildFullLines(t, "ref");

    expect(result.subtotal).toBe(1000);
    expect(result.tax).toBe(80);
  });

  it("multiplies quantity × unit_amount for a scaling row, e.g. 6 attendees at $105", () => {
    const t = totals({
      lineItems: [line({ name: "Class", unit: "Person", qty: 6, price: 105, amount: 630 })],
      subtotal: 630,
      tax: 0,
      total: 630,
    });

    const result = buildFullLines(t, "ref");

    expect(result.lines[0].quantity).toBe(6);
    expect(result.lines[0].unit_amount).toBe(105);
    expect(result.lines[0].qty_basis).toBe("attendee");
    expect(result.lines[0].line_total).toBe(630);
  });

  it("falls back to one summary line when the fee table has no rows at all", () => {
    const t = totals({ lineItems: [], subtotal: 0, tax: 50, total: 550 });

    const result = buildFullLines(t, "Some Proposal");

    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].description).toContain("Some Proposal");
    expect(result.lines[0].line_total).toBe(500);
    expect(result.tax).toBe(50);
  });

  it("prints a catalog service's category above its name, e.g. Training over the course name", () => {
    const t = totals({
      lineItems: [
        line({ source: "service", key: "firstAid", name: "First Aid / CPR / AED Training", unit: "Person", qty: 1, price: 145, amount: 145 }),
        line({ source: "service", key: "bbp", name: "Bloodborne Pathogens Training", unit: "Session", qty: 1, price: 400, amount: 400 }),
      ],
      subtotal: 545,
      total: 545,
    });

    const result = buildFullLines(t, "ref");

    expect(result.lines[0].description).toBe("Training\nFirst Aid / CPR / AED Training");
    expect(result.lines[1].description).toBe("Training\nBloodborne Pathogens Training");
  });

  it("labels the catalog's own 'Custom Service Line' entry as Service, not Training", () => {
    const t = totals({
      lineItems: [line({ source: "service", key: "custom", name: "Bespoke Consulting Engagement", unit: "", qty: 1, price: 500, amount: 500 })],
      subtotal: 500,
      total: 500,
    });

    const result = buildFullLines(t, "ref");

    expect(result.lines[0].description).toBe("Service\nBespoke Consulting Engagement");
  });

  it("stays a single line for a service key that resolves to nothing in the catalog", () => {
    const t = totals({
      lineItems: [line({ source: "service", key: "not-a-real-key", name: "Whatever The Seller Typed", unit: "", qty: 1, price: 500, amount: 500 })],
      subtotal: 500,
      total: 500,
    });

    const result = buildFullLines(t, "ref");

    expect(result.lines[0].description).toBe("Whatever The Seller Typed");
  });

  it("stays a single line for a package or phase row, which carries no catalog group", () => {
    const t = totals({
      lineItems: [line({ source: "package", key: "growth", name: "Growth Plan", unit: "", qty: 1, price: 1000, amount: 1000 })],
      subtotal: 1000,
      total: 1000,
    });

    const result = buildFullLines(t, "ref");

    expect(result.lines[0].description).toBe("Growth Plan");
  });
});
