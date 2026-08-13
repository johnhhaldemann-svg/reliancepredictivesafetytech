import { lifecycleStages } from "@/lib/company-data";

/**
 * When a company's pipeline stage is allowed to move on its own.
 *
 * Eleven of the twelve stages only ever moved because somebody dragged a card,
 * so the board was as accurate as the last person's memory. The events that
 * should drive them already exist as records — a proposal being sent, a demo
 * being booked, a checklist item being completed — they were simply never read.
 *
 * Pure decision logic only, so the rules are unit-testable. The write half is
 * lifecycle-server.ts, matching the split proposals already uses for
 * approval / approval-server and notifications / notifications-server.
 *
 * THE RULE THAT MATTERS: a derived stage change never walks a company
 * backwards. A company at Onboarding must not be dragged back to Signed / Won
 * because a second proposal closed, nor back to Proposal Sent because someone
 * sent a follow-up quote. Automation may only ever move a deal forward.
 */

export type LifecycleStage = (typeof lifecycleStages)[number];

/**
 * Stages that events drive, named rather than spelled out at each call site so
 * a rename in lib/company-data.ts is a compile error instead of a silent no-op:
 * `shouldAdvanceStage` refuses an unrecognised target, so a stale string here
 * would quietly stop advancing anything.
 */
export const proposalSentLifecycleStage: LifecycleStage = "Proposal Sent";

/**
 * Position in the pipeline, or -1 when the stage is not one of the twelve.
 *
 * An unrecognised or empty stage is treated as BEFORE everything rather than
 * after it, so a company carrying a retired stage value still advances to a
 * real one. This matches what acceptance already did: its hardcoded "at or
 * past won" set listed only real stages, so anything else advanced.
 */
export function stageRank(stage: string | null | undefined): number {
  if (!stage) return -1;
  return lifecycleStages.indexOf(stage as LifecycleStage);
}

/** True when `stage` is a stage this codebase knows about. */
export function isKnownStage(stage: string | null | undefined): stage is LifecycleStage {
  return stageRank(stage) !== -1;
}

/**
 * Whether an event may move `current` to `target`.
 *
 * False when the company is already at or past the target, which is what keeps
 * automation from walking a deal backwards. Also false when `target` is not a
 * real stage — a caller passing a typo must not blank out a live company's
 * position.
 */
export function shouldAdvanceStage(current: string | null | undefined, target: string): boolean {
  const targetRank = stageRank(target);
  if (targetRank === -1) return false;
  return stageRank(current) < targetRank;
}
