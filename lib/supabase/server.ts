import { cache } from "react";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Database } from "@/lib/supabase/types";
import { getSupabaseEnv } from "@/lib/supabase/env";
import { getPortalRoleCommandRank } from "@/lib/user-management";

export async function createClient() {
  const env = getSupabaseEnv();

  if (!env) {
    return null;
  }

  const cookieStore = await cookies();

  return createServerClient<Database>(env.url, env.key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server Components cannot write cookies; middleware refreshes sessions.
        }
      },
    },
  });
}

/**
 * Use in Server Actions and Route Handlers instead of createClient().
 * Redirects to login if Supabase env vars are missing — guarantees the
 * returned client is never null, so callers need no null check.
 */
export async function requireClient() {
  const client = await createClient();
  if (!client) {
    redirect("/employee-login?message=supabase-required");
  }
  return client;
}

export interface SessionRoleRow {
  role: string | null;
  account_status: string | null;
  can_approve_proposals?: boolean | null;
}

export interface SessionContext {
  supabase: Awaited<ReturnType<typeof createClient>>;
  user: { id: string; email: string | null } | null;
  /** The strongest ACTIVE role, by command rank. Null when none is active. */
  role: string | null;
  accountStatus: string | null;
  /** Almost every caller wants this rather than the raw status string. */
  isActive: boolean;
  /**
   * Every active role row, so a module-specific helper can derive its own
   * capabilities without paying for a second round trip.
   */
  roleRows: SessionRoleRow[];
}

/**
 * Who is asking, and what they are allowed to be — resolved once per request.
 *
 * Wrapped in React's cache(), so the auth round trip and the user_roles lookup
 * happen at most once no matter how many times this is called while rendering
 * a single request. Before this, the employee layout fetched both and then the
 * page rendered inside it fetched them again, through one of five near-identical
 * bespoke helpers (files, proposals, talent-engine, legal, time-off) that had
 * already started to drift — some filtered on account_status in the query,
 * others checked it afterwards.
 *
 * Memoization is per-request, so there is no cross-user leakage and no change
 * in behaviour under RLS: the same queries run, just not repeatedly.
 */
export const getSessionContext = cache(async (): Promise<SessionContext> => {
  const empty = { role: null, accountStatus: null, isActive: false, roleRows: [] as SessionRoleRow[] };

  const supabase = await createClient();
  if (!supabase) return { supabase: null, user: null, ...empty };

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, ...empty };

  // Deliberately NOT .maybeSingle(). A user carrying two active user_roles rows
  // makes PostgREST return PGRST116 with data = null, which would read here as
  // "no role at all" and lock them out of their own portal — the exact bug
  // lib/proposals/access.ts documents. RLS grants on `exists(... role in (...))`,
  // so duplicates effectively resolve to the strongest active role; resolve the
  // same way.
  const { data: rows } = await supabase
    .from("user_roles")
    .select("role, account_status, can_approve_proposals")
    .eq("user_id", user.id)
    .eq("account_status", "active");

  const roleRows: SessionRoleRow[] = Array.isArray(rows) ? rows : [];
  const role =
    roleRows
      .map((row) => row?.role ?? null)
      .sort((a, b) => getPortalRoleCommandRank(a) - getPortalRoleCommandRank(b))[0] ?? null;

  return {
    supabase,
    user: { id: user.id, email: user.email ?? null },
    role,
    accountStatus: roleRows.length > 0 ? "active" : null,
    isActive: roleRows.length > 0,
    roleRows,
  };
});
