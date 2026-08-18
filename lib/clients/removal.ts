import { clientStatuses } from "@/lib/company-data";
import { portalUserRoles, type PortalUserRole } from "@/lib/user-management";

/**
 * Taking a company off the client lifecycle, and putting it back.
 *
 * Every company ever created — a duplicate, a test row, a lead that turned out
 * to be somebody's personal email — sat on the Client Lifecycle directory, the
 * pipeline board and the stage counts forever, because the only writes the
 * platform had were "create" and "move to another stage". There was no way to
 * say "this is not a deal".
 *
 * Removal is a SOFT remove: the row keeps its status column, and everything
 * hanging off the company — proposals, files, contacts, onboarding checklist,
 * training events, invoiced income — stays exactly where it is. That is a
 * deliberate choice, not a shortcut. `company_clients` is the parent of five
 * `on delete cascade` children and six `on delete set null` ones, so a real
 * DELETE would silently take a signed proposal's client link with it. It also
 * has no DELETE policy in RLS (see
 * supabase/migrations/20260506000000_sales_to_active_company_system.sql — only
 * select / insert / update are granted), so a hard delete would match zero rows
 * and report success having done nothing.
 *
 * Pure decision logic only, so the rules are unit-testable. The write half is
 * app/employee/clients/actions.ts, matching the split lifecycle.ts already uses.
 */

/**
 * Annotating both constants below with this makes a rename in
 * lib/company-data.ts a compile error here rather than a silent no-op: a stale
 * string would leave `isRemovedClient` matching nothing and quietly stop hiding
 * anything.
 */
type ClientStatus = (typeof clientStatuses)[number];

/**
 * The status a removed company carries. Already one of the four `clientStatuses`
 * the platform has always declared — this module is what finally gives it a
 * meaning, rather than adding a fifth state or a new column.
 */
export const removedClientStatus: ClientStatus = "Archived";

/**
 * What restoring writes back. The status a company held before it was removed
 * is not stored anywhere, so "Paused" and "Lost" both come back as "Active";
 * the prior value is captured in the audit event's before_state instead of
 * being guessed at here.
 */
export const restoredClientStatus: ClientStatus = "Active";

/**
 * Whether a company has been removed from the lifecycle.
 *
 * Case- and whitespace-insensitive because `status` is a free-text column with
 * no CHECK constraint, and the company profile form writes it through a plain
 * text input — "archived" typed by hand must hide the company just as surely as
 * the button does, or the directory would show a row the owner believes is gone.
 */
export function isRemovedClient(status: string | null | undefined): boolean {
  return (status ?? "").trim().toLowerCase() === removedClientStatus.toLowerCase();
}

/** True when `status` is one a live company may hold. */
export function isLiveClient(status: string | null | undefined): boolean {
  return !isRemovedClient(status);
}

/**
 * Whether the directory was asked to include removed companies.
 *
 * Opt-in: the whole point of removing a company is that it stops appearing, so
 * anything other than an explicit "1" leaves them hidden.
 */
export function resolveIncludeRemoved(raw: string | undefined): boolean {
  return (raw ?? "").trim() === "1";
}

export interface ClientRemovalFlags {
  /** May take a company off the lifecycle. */
  canRemove: boolean;
  /** May put a removed company back. */
  canRestore: boolean;
}

const denied: ClientRemovalFlags = { canRemove: false, canRestore: false };

/**
 * The role whitelist enforced by `public.is_company_portal_employee()`, which is
 * what the `company_clients` UPDATE policy grants on. `portalUserRoles` is that
 * exact set, so the app-level check and the RLS predicate cannot drift.
 */
function isClientPortalRole(role: string | null | undefined): role is PortalUserRole {
  return portalUserRoles.includes(role as PortalUserRole);
}

/**
 * Maps a portal role + active status onto removal capabilities.
 *
 * Deliberately the same audience as every other pipeline write: any active
 * employee may already drag a company from Lead to Signed / Won, so gating the
 * reversible, audited act of hiding one behind an admin role would put the UI
 * out of step with what RLS actually allows — and hide a button the database
 * would have honoured. Restore is granted with removal for the same reason:
 * a viewer who can remove must be able to undo it without finding an admin.
 *
 * RLS is still the binding constraint. This check exists so a user the database
 * will reject is told so up front, instead of seeing a success message backed
 * by a silent zero-row write.
 */
export function resolveClientRemovalFlags(role: string | null | undefined, isActive: boolean): ClientRemovalFlags {
  if (!isActive || !isClientPortalRole(role)) return { ...denied };
  return { canRemove: true, canRestore: true };
}
