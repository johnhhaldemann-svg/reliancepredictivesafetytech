import { describe, expect, it } from "vitest";
import { amountForKind } from "@/lib/invoices/create-from-proposal";

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
