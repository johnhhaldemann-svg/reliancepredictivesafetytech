import "server-only";
import { getSessionContext } from "@/lib/supabase/server";
import { resolveProposalRoleFlags, type ProposalRoleFlags } from "./policy";

export interface ProposalAccess extends ProposalRoleFlags {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
  userId: string | null;
  role: string | null;
}

/**
 * Resolves the current user's Proposal Builder access.
 *
 * Reads from the request-memoized getSessionContext rather than issuing its own
 * auth + user_roles round trip, so a page that renders inside the employee
 * layout pays for those once instead of twice. The duplicate-active-rows
 * handling this module documented now lives in that shared helper, which also
 * fetches can_approve_proposals so this stays a pure derivation.
 */
export async function getProposalAccess(): Promise<ProposalAccess> {
  const session = await getSessionContext();
  if (!session.supabase) {
    return { supabase: null, userId: null, role: null, canRead: false, canManage: false, isAdmin: false, canApprove: false };
  }

  if (!session.user) {
    return { supabase: session.supabase, userId: null, role: null, canRead: false, canManage: false, isAdmin: false, canApprove: false };
  }

  // Resolved across ALL active rows, matching how the strongest role is picked:
  // a user carrying two rows is granted the capability if either row grants it,
  // rather than depending on which row happened to sort first.
  const canApproveProposals = session.roleRows.some((row) => row?.can_approve_proposals === true);
  const flags = resolveProposalRoleFlags(session.role, session.roleRows.length > 0, canApproveProposals);

  return { supabase: session.supabase, userId: session.user.id, role: session.role, ...flags };
}
