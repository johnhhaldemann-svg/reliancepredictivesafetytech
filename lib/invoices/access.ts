import "server-only";

import { getSessionContext } from "@/lib/supabase/server";
import { canAccessEmployeePath, hasFullPortalVisibility, isPortalAdminRole, isPortalOwnerRole } from "@/lib/user-management";

export interface InvoiceAccess {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
  userId: string | null;
  role: string | null;
  /** Same gate app/employee/invoices/page.tsx uses: finance-authorised users and owners. */
  canSeeMoney: boolean;
  /**
   * Maps to is_company_portal_admin() in RLS — the only role tier that can
   * UPDATE a client_invoices header row ("Admins can settle invoices"). Line
   * items are a broader grant: any employee may edit a draft invoice's lines.
   */
  isAdmin: boolean;
}

/**
 * Resolves the current user's Invoice module access.
 *
 * Reuses the request-memoized getSessionContext for the auth + role round
 * trip, and layers on the two finance-specific checks the ledger page already
 * does inline — centralised here so the ledger, the create-from-proposal
 * action and the invoice edit page cannot drift the way the pre-session-context
 * per-module access helpers already had.
 */
export async function getInvoiceAccess(): Promise<InvoiceAccess> {
  const session = await getSessionContext();
  const empty: InvoiceAccess = {
    supabase: session.supabase ?? null,
    userId: null,
    role: null,
    canSeeMoney: false,
    isAdmin: false,
  };

  if (!session.supabase || !session.user) {
    return empty;
  }

  const [{ data: financeAuthorization }, { data: moduleAccess }] = await Promise.all([
    session.supabase.from("company_finance_authorized_users").select("user_id").eq("user_id", session.user.id).maybeSingle(),
    hasFullPortalVisibility(session.role, session.accountStatus)
      ? Promise.resolve({ data: [] })
      : session.supabase.from("portal_user_module_access").select("module_key").eq("user_id", session.user.id),
  ]);

  const moduleKeys = (moduleAccess ?? []).map((row: { module_key: string }) => row.module_key);

  const canSeeMoney = Boolean(
    session.accountStatus === "active" &&
      canAccessEmployeePath(session.role, session.accountStatus, "/employee/finance", moduleKeys) &&
      (isPortalOwnerRole(session.role) || financeAuthorization),
  );

  return {
    supabase: session.supabase,
    userId: session.user.id,
    role: session.role,
    canSeeMoney,
    isAdmin: isPortalAdminRole(session.role),
  };
}
