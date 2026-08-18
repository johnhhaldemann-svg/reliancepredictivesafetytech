/**
 * Which dashboard a person sees, and how they change their mind.
 *
 * The redesign ships beside the original rather than on top of it. Both
 * dashboards exist at their own route, a person picks one, and the choice is
 * remembered in a cookie. Deliberately a cookie and not a column:
 *
 *   - no migration, so nothing has to be rehearsed against staging
 *   - no RLS surface, so no tenant-isolation question to answer
 *   - reversible by one person clearing one cookie, and reversible for
 *     everyone by reverting the redirect in app/employee/page.tsx
 *
 * If the new dashboard turns out to be wrong, nothing has to be undone in the
 * database to get the old one back.
 *
 * Pure and dependency-free so it is unit-testable, matching the split the
 * lifecycle and proposal modules already use.
 */

/**
 * Prefixed rpst for Reliance Predictive Safety Technologies — this internal
 * platform. Not siq: SafetyIQ is the separate MACO / BIO product line, and
 * nothing in this repo belongs to it.
 */
export const dashboardCookieName = "rpst_dashboard";

/** A year. The choice should outlive a browser restart. */
export const dashboardCookieMaxAge = 60 * 60 * 24 * 365;

export const dashboardVariants = ["focus", "classic"] as const;

export type DashboardVariant = (typeof dashboardVariants)[number];

/**
 * Classic wins by default. A person who has never chosen sees exactly what
 * they saw yesterday — the new dashboard is opt-in, never sprung on anyone.
 */
export const defaultDashboardVariant: DashboardVariant = "classic";

const variantPaths: Record<DashboardVariant, string> = {
  focus: "/employee/home",
  classic: "/employee",
};

const variantLabels: Record<DashboardVariant, string> = {
  focus: "Focus",
  classic: "Classic",
};

function isDashboardVariant(value: unknown): value is DashboardVariant {
  return typeof value === "string" && dashboardVariants.includes(value as DashboardVariant);
}

/**
 * Read a cookie value into a variant.
 *
 * Anything unrecognised falls back to classic rather than throwing. A stale or
 * hand-edited cookie should land a person on the dashboard that has always
 * worked, not on an error page.
 */
export function parseDashboardVariant(raw: string | null | undefined): DashboardVariant {
  return isDashboardVariant(raw) ? raw : defaultDashboardVariant;
}

/** The one they are not on — what the switch offers them. */
export function otherDashboardVariant(variant: DashboardVariant): DashboardVariant {
  return variant === "focus" ? "classic" : "focus";
}

export function dashboardVariantPath(variant: DashboardVariant): string {
  return variantPaths[variant];
}

export function dashboardVariantLabel(variant: DashboardVariant): string {
  return variantLabels[variant];
}

/** Cookie attributes. Not httpOnly — nothing secret, and no auth decision rests on it. */
export function dashboardCookieOptions() {
  return {
    path: "/",
    maxAge: dashboardCookieMaxAge,
    sameSite: "lax" as const,
    httpOnly: false,
  };
}
