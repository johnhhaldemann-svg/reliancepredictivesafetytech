// Lookup surface for the generator registry. Everything outside lib/documents
// should import from here rather than reaching into registry.ts, so the shape
// of the catalog stays free to change.

import { generatorRegistry } from "./registry";
import { generatorGroups, type GeneratorGroup, type GeneratorSpec } from "./types";

export { generatorRegistry } from "./registry";
export { HOUSE_STYLE, QUALITY_GATE, DEFAULT_JURISDICTION_NOTE, NEEDS_INPUT_MARKER, toneDescriptors, coerceTone, isDocumentTone } from "./house-style";
export * from "./types";

/** Every generator key, in registry order. Matches the doc_type CHECK constraint. */
export const generatorKeys: readonly string[] = generatorRegistry.map((g) => g.key);

const byKey = new Map<string, GeneratorSpec>(generatorRegistry.map((g) => [g.key, g]));

export function getGenerator(key: string | null | undefined): GeneratorSpec | null {
  if (!key) return null;
  return byKey.get(key) ?? null;
}

/** Throws rather than returning null — for call sites that have already validated. */
export function requireGenerator(key: string): GeneratorSpec {
  const spec = byKey.get(key);
  if (!spec) throw new Error(`Unknown document generator "${key}".`);
  return spec;
}

export function isGeneratorKey(value: unknown): value is string {
  return typeof value === "string" && byKey.has(value);
}

/** Display labels, keyed by generator key. Used by the drafts table and review panel. */
export const generatorLabels: Readonly<Record<string, string>> = Object.fromEntries(
  generatorRegistry.map((g) => [g.key, g.label]),
);

/** Groups in display order, each with its generators. Empty groups are omitted. */
export function generatorsByGroup(): Array<{ group: GeneratorGroup; generators: GeneratorSpec[] }> {
  return generatorGroups
    .map((group) => ({ group, generators: generatorRegistry.filter((g) => g.group === group) }))
    .filter((entry) => entry.generators.length > 0);
}
