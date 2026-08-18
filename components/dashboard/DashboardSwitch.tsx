import { ArrowLeftRight } from "lucide-react";
import { chooseDashboard } from "@/app/employee/home/actions";
import {
  dashboardVariantLabel,
  otherDashboardVariant,
  type DashboardVariant,
} from "@/lib/dashboard/preference";

/**
 * The switch between the two dashboards.
 *
 * Sits on both, so wherever a person ends up they can get back. A form posting
 * a server action rather than a link, because the choice has to be written
 * before the redirect — a plain link would move them without remembering.
 */
export function DashboardSwitch({ current }: { current: DashboardVariant }) {
  const target = otherDashboardVariant(current);

  return (
    <form action={chooseDashboard} className="dashboard-switch">
      <input name="variant" type="hidden" value={target} />
      <span className="dashboard-switch-current">
        {dashboardVariantLabel(current)}
        {current === "focus" ? <span className="dashboard-switch-tag">New</span> : null}
      </span>
      <button className="button button-light dashboard-switch-button" type="submit">
        <ArrowLeftRight size={15} />
        Switch to {dashboardVariantLabel(target).toLowerCase()}
      </button>
    </form>
  );
}
