import { lifecycleStages } from "@/lib/company-data";

/**
 * Value-level guard on AI-proposed patches.
 *
 * `proposalPatchAllowList` in app/employee/ai/actions.ts gates which COLUMNS a
 * workflow proposal may write. It never gated the VALUE, so an approved
 * proposal could put any string at all into a column whose meaning is an enum.
 * That is how a company came to carry the stage "Invoicing", which is not one
 * of the twelve lifecycle stages: no column in the database rejected it, and
 * no screen showed it as wrong.
 *
 * A company on an unrecognised stage is worse than merely untidy. It gets no
 * column on the Lifecycle Board, it is missed by the stage filter on the
 * directory, and `stageRank` in lib/clients/lifecycle.ts ranks it -1 — BEFORE
 * everything — so automation is free to jump it to any stage at all. That -1
 * behaviour is deliberate (a company on a retired stage must still be able to
 * move forward); the fix belongs here, at the point of write, not there.
 *
 * Pure and dependency-free so it is unit-testable, matching the split the
 * lifecycle and proposal modules already use.
 */

/** Columns whose value must be one of a fixed set, by table. */
const enumColumnValues: Record<string, Record<string, readonly string[]>> = {
  company_clients: {
    lifecycle_stage: lifecycleStages,
  },
};

export type PatchValueResult = {
  /** The patch with any out-of-range enum value removed. */
  patch: Record<string, unknown>;
  /** Columns dropped because the proposed value was not a permitted one. */
  dropped: string[];
};

/**
 * Whether `value` is permitted for `table`.`column`.
 *
 * A column with no declared enum is unconstrained here and passes. A declared
 * column accepts only an exact string match — no trimming, no case folding,
 * because "signed / won" is not a stage the rest of the codebase compares
 * equal to "Signed / Won".
 */
export function isAllowedPatchValue(table: string, column: string, value: unknown): boolean {
  const allowed = enumColumnValues[table]?.[column];

  if (!allowed) {
    return true;
  }

  return typeof value === "string" && allowed.includes(value);
}

/**
 * Drop every column of `patch` whose value is out of range for `table`.
 *
 * Dropping rather than throwing is deliberate: a proposal that sets four
 * columns and gets one of them wrong should still apply the three that are
 * right, the same way an unknown column is dropped rather than failing the
 * whole patch. `dropped` is returned so the caller can record what was
 * refused instead of losing it silently.
 */
export function dropDisallowedPatchValues(table: string, patch: Record<string, unknown>): PatchValueResult {
  const kept: Record<string, unknown> = {};
  const dropped: string[] = [];

  for (const [column, value] of Object.entries(patch)) {
    if (isAllowedPatchValue(table, column, value)) {
      kept[column] = value;
    } else {
      dropped.push(column);
    }
  }

  return { patch: kept, dropped };
}
