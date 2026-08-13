import "server-only";
import { getSessionContext } from "@/lib/supabase/server";
import { resolveFileRoleFlags } from "@/lib/files/policy";

export interface FileCenterAccess {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
  userId: string | null;
  role: string | null;
  isActive: boolean;
  flags: ReturnType<typeof resolveFileRoleFlags>;
}

/**
 * Resolves the current user's File Center access. Every active employee may
 * browse and organise company/client files (canRead/canManage); permanently
 * deleting a file is reserved for portal admins (canDelete). RLS enforces the
 * same split at the database layer — these flags only drive the UI and the
 * server-action guards.
 */
export async function getFileCenterAccess(): Promise<FileCenterAccess> {
  // Shares the request-memoized session lookup with the layout and every other
  // module, rather than repeating the auth and user_roles round trips.
  const session = await getSessionContext();
  if (!session.supabase) {
    return { supabase: null, userId: null, role: null, isActive: false, flags: resolveFileRoleFlags(null, false) };
  }

  if (!session.user) {
    return { supabase: session.supabase, userId: null, role: null, isActive: false, flags: resolveFileRoleFlags(null, false) };
  }

  return {
    supabase: session.supabase,
    userId: session.user.id,
    role: session.role,
    isActive: session.isActive,
    flags: resolveFileRoleFlags(session.role, session.isActive),
  };
}
