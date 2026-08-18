"use server";

// Server Actions for taking a company off the client lifecycle and putting it
// back (MODULE_ID: active_companies — the same module key that already maps
// /employee/clients in lib/user-management.ts).
//
// The rules these enforce live in lib/clients/removal.ts, which is pure and
// unit-tested; this file is the write half. Nothing here deletes a row: see
// that module for why a real DELETE would take a signed proposal's client link
// with it and, in any case, match zero rows under the current RLS grants.
//
// Authorization is RLS plus an explicit session gate. Every policy on
// company_clients requires is_company_portal_employee(), so a signed-in
// non-employee gets a zero-row write — which the `.select()` on each statement
// turns into a visible failure rather than a silent success.

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/supabase/server";
import { buildDataAuditEvent, recordAuditEvent } from "@/lib/audit/events";
import {
  isRemovedClient,
  removedClientStatus,
  resolveClientRemovalFlags,
  restoredClientStatus,
} from "@/lib/clients/removal";

export interface ClientRemovalResult {
  ok: boolean;
  error?: string;
}

// Deliberately NOT exported, here and below: a "use server" file may only
// export async functions — any other export makes Next.js throw at module
// evaluation and takes every action in the file down with it
// (lib/guardrails/use-server-exports.test.ts enforces this repo-wide).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * PostgREST returns no error for an UPDATE that matched zero rows — whether the
 * id does not exist or RLS filtered it out. Both statements below ask for the
 * affected id back and treat an empty result as a failure, so we never report
 * success (or write an audit event) for a no-op.
 */
const NO_ROWS = "Company not found, or you do not have permission to change it.";

/** Every surface that counts or lists companies by stage. */
function revalidateLifecycle(clientId: string) {
  revalidatePath("/employee/clients");
  revalidatePath(`/employee/clients/${clientId}`);
  revalidatePath("/employee/sales");
  revalidatePath("/employee/active-companies");
  // The dashboard reads pipeline counts off the same table.
  revalidatePath("/employee");
}

/**
 * Moves a company between the live board and the removed list.
 *
 * `expectRemoved` is what the caller believes the company's current state to
 * be. Checking it turns a stale button — two people on the directory at once,
 * one of whom already acted — into a clear message instead of a write that
 * silently reverses somebody else's decision.
 */
async function setClientRemoved(clientId: string, expectRemoved: boolean): Promise<ClientRemovalResult> {
  if (!UUID.test(clientId ?? "")) return { ok: false, error: "Missing company id." };

  const session = await getSessionContext();
  if (!session.supabase || !session.user) return { ok: false, error: "You must be signed in." };

  const flags = resolveClientRemovalFlags(session.role, session.isActive);
  if (!flags.canRemove || !flags.canRestore) {
    return { ok: false, error: "You do not have permission to change the client lifecycle." };
  }

  const { data: client, error: loadError } = await session.supabase
    .from("company_clients")
    .select("id, name, status, lifecycle_stage")
    .eq("id", clientId)
    .maybeSingle();
  if (loadError) return { ok: false, error: loadError.message };
  if (!client) return { ok: false, error: NO_ROWS };

  const currentStatus = (client.status as string | null) ?? "";
  const alreadyRemoved = isRemovedClient(currentStatus);
  if (alreadyRemoved === expectRemoved) {
    return {
      ok: false,
      error: expectRemoved
        ? `${client.name} is already off the lifecycle. Refresh to see the current list.`
        : `${client.name} is already on the lifecycle. Refresh to see the current list.`,
    };
  }

  const nextStatus = expectRemoved ? removedClientStatus : restoredClientStatus;

  const { data: updated, error } = await session.supabase
    .from("company_clients")
    .update({ status: nextStatus })
    .eq("id", clientId)
    // Conditional on what was read, so this cannot overwrite a status somebody
    // set by hand between the read and the write — the same guard
    // advanceClientStage uses on lifecycle_stage.
    .eq("status", currentStatus)
    .select("id");

  if (error) return { ok: false, error: error.message };
  if (!updated || updated.length === 0) return { ok: false, error: NO_ROWS };

  await recordAuditEvent({
    ...buildDataAuditEvent(
      "update",
      "company_client",
      clientId,
      session.user.id,
      expectRemoved
        ? `Removed "${client.name}" from the client lifecycle (was ${client.lifecycle_stage})`
        : `Restored "${client.name}" to the client lifecycle (${client.lifecycle_stage})`,
      // The prior status is the only record of it: restoring always writes
      // "Active", so a company removed while Paused or Lost is recoverable
      // from here and nowhere else.
      { status: currentStatus, lifecycle_stage: client.lifecycle_stage },
      { status: nextStatus, lifecycle_stage: client.lifecycle_stage },
    ),
    actor_role: session.role,
  });

  revalidateLifecycle(clientId);
  return { ok: true };
}

/**
 * Takes a company off the lifecycle: it leaves the directory, the pipeline
 * board, Active Companies and the stage counts. Everything hanging off it —
 * proposals, files, contacts, checklist, invoiced income — is untouched, and
 * "Show removed" on the directory brings it back into view.
 */
export async function removeClientFromLifecycle(clientId: string): Promise<ClientRemovalResult> {
  return setClientRemoved(clientId, true);
}

/** Puts a removed company back on the lifecycle at the stage it left from. */
export async function restoreClientToLifecycle(clientId: string): Promise<ClientRemovalResult> {
  return setClientRemoved(clientId, false);
}
