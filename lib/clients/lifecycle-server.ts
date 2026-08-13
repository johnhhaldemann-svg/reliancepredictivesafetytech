import "server-only";

import { shouldAdvanceStage } from "./lifecycle";

/**
 * Moves a company's pipeline stage in response to an event.
 *
 * The write half of lib/clients/lifecycle.ts. Every event-driven stage change
 * goes through here so the never-walk-backwards rule and the conditional write
 * are stated once rather than re-derived per caller.
 *
 * BEST-EFFORT BY CONTRACT, like the acceptance bookkeeping it generalises. The
 * business event is the proposal being sent or accepted; the stage is a
 * reflection of it. A failure here must never turn into a failed send.
 */

/** Same convention as the rest of the platform (see proposals/access.ts). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LooseClient = any;

export interface AdvanceStageResult {
  /** True only when a row was actually moved. */
  advanced: boolean;
  /** Set when the attempt failed outright, as opposed to being declined. */
  error?: string;
}

export async function advanceClientStage(
  db: LooseClient,
  clientId: string | null | undefined,
  target: string,
): Promise<AdvanceStageResult> {
  if (!db || !clientId) return { advanced: false };

  try {
    const { data: client } = await db
      .from("company_clients")
      .select("lifecycle_stage")
      .eq("id", clientId)
      .maybeSingle();
    if (!client) return { advanced: false };

    const current = (client.lifecycle_stage as string | null) ?? "";
    if (!shouldAdvanceStage(current, target)) return { advanced: false };

    const { data: updated, error } = await db
      .from("company_clients")
      .update({ lifecycle_stage: target })
      .eq("id", clientId)
      // Conditional on what was read, so this cannot overwrite a stage somebody
      // set by hand between the read and the write.
      .eq("lifecycle_stage", current)
      .select("id");

    if (error) return { advanced: false, error: error.message };
    return { advanced: Array.isArray(updated) && updated.length > 0 };
  } catch (caught) {
    return {
      advanced: false,
      error: caught instanceof Error ? caught.message : "Unexpected failure while advancing the stage.",
    };
  }
}
