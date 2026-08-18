import { describe, expect, it } from "vitest";
import {
  dashboardCookieName,
  dashboardCookieOptions,
  dashboardVariantLabel,
  dashboardVariantPath,
  dashboardVariants,
  defaultDashboardVariant,
  otherDashboardVariant,
  parseDashboardVariant,
} from "@/lib/dashboard/preference";

describe("parseDashboardVariant", () => {
  it("accepts every declared variant", () => {
    for (const variant of dashboardVariants) {
      expect(parseDashboardVariant(variant)).toBe(variant);
    }
  });

  it("falls back to classic for anything unrecognised, rather than throwing", () => {
    expect(parseDashboardVariant("nonsense")).toBe("classic");
    expect(parseDashboardVariant("")).toBe("classic");
    expect(parseDashboardVariant(null)).toBe("classic");
    expect(parseDashboardVariant(undefined)).toBe("classic");
  });

  it("does not guess at a near miss", () => {
    expect(parseDashboardVariant("Focus")).toBe("classic");
    expect(parseDashboardVariant(" focus ")).toBe("classic");
  });

  it("defaults to the dashboard that already worked", () => {
    expect(defaultDashboardVariant).toBe("classic");
  });
});

describe("otherDashboardVariant", () => {
  it("offers the one you are not on", () => {
    expect(otherDashboardVariant("focus")).toBe("classic");
    expect(otherDashboardVariant("classic")).toBe("focus");
  });

  it("round-trips", () => {
    for (const variant of dashboardVariants) {
      expect(otherDashboardVariant(otherDashboardVariant(variant))).toBe(variant);
    }
  });
});

describe("routing and labels", () => {
  it("sends each variant to its own route", () => {
    expect(dashboardVariantPath("classic")).toBe("/employee");
    expect(dashboardVariantPath("focus")).toBe("/employee/home");
  });

  it("gives every variant a human label", () => {
    for (const variant of dashboardVariants) {
      expect(dashboardVariantLabel(variant).length).toBeGreaterThan(0);
    }
  });
});

describe("cookie", () => {
  it("is named once, so the reader and the writer cannot drift", () => {
    expect(dashboardCookieName).toBe("rpst_dashboard");
  });

  it("is site-wide, long-lived and carries no auth weight", () => {
    const options = dashboardCookieOptions();

    expect(options.path).toBe("/");
    expect(options.sameSite).toBe("lax");
    expect(options.httpOnly).toBe(false);
    expect(options.maxAge).toBeGreaterThan(60 * 60 * 24 * 300);
  });
});
