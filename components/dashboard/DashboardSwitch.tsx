import { chooseDashboard } from "@/app/employee/home/actions";
import {
  dashboardVariantLabel,
  dashboardVariants,
  type DashboardVariant,
} from "@/lib/dashboard/preference";

/**
 * The two dashboards as two tabs.
 *
 * Sits at the top of both, so wherever a person lands they can see that a
 * second dashboard exists and move to it in one click. The tab they are on is
 * marked current and does nothing when pressed; the other one writes the
 * preference and takes them there.
 *
 * A form posting a server action rather than links, because the choice has to
 * be written before the redirect — a plain link would move them without
 * remembering, and they would bounce back on their next visit.
 */
export function DashboardSwitch({ current }: { current: DashboardVariant }) {
  return (
    <form action={chooseDashboard} className="dashboard-tabs" role="group" aria-label="Choose a dashboard">
      {dashboardVariants.map((variant) => {
        const isCurrent = variant === current;

        return (
          <button
            aria-current={isCurrent ? "page" : undefined}
            className={`dashboard-tab${isCurrent ? " is-current" : ""}`}
            disabled={isCurrent}
            key={variant}
            name="variant"
            type="submit"
            value={variant}
          >
            {dashboardVariantLabel(variant)}
            {variant === "focus" ? <span className="dashboard-tab-tag">New</span> : null}
          </button>
        );
      })}
    </form>
  );
}
