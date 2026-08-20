import { describe, expect, it } from "vitest";
import { lineTotalFor } from "@/lib/invoices/draft";

describe("lineTotalFor — respects qty_basis, unlike a naive quantity × unit_amount", () => {
  it("scales with quantity for session/attendee/hour", () => {
    expect(lineTotalFor({ quantity: 10, unit_amount: 105, qty_basis: "attendee" })).toBe(1050);
    expect(lineTotalFor({ quantity: 3, unit_amount: 200, qty_basis: "session" })).toBe(600);
    expect(lineTotalFor({ quantity: 2.5, unit_amount: 100, qty_basis: "hour" })).toBe(250);
  });

  it("ignores quantity for flat — a stray 2 cannot double a retainer", () => {
    expect(lineTotalFor({ quantity: 2, unit_amount: 5000, qty_basis: "flat" })).toBe(5000);
  });

  it("defaults to flat when qty_basis is missing", () => {
    expect(lineTotalFor({ quantity: 4, unit_amount: 1200 })).toBe(1200);
  });

  it("rounds to cents", () => {
    expect(lineTotalFor({ quantity: 3, unit_amount: 0.655, qty_basis: "hour" })).toBe(1.97);
  });

  it("coerces non-finite input to zero rather than NaN", () => {
    expect(lineTotalFor({ quantity: "abc", unit_amount: 100, qty_basis: "hour" })).toBe(0);
  });
});
