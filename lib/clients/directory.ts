import { lifecycleStages } from "@/lib/company-data";

/**
 * Query shaping for the company directory (/employee/clients).
 *
 * Everything here is pure so the filter strings that reach PostgREST can be
 * tested directly. The page itself stays a server component and applies these
 * in the DATABASE query — no client-side Supabase reads (CLAUDE.md).
 */

/** Bounds the search term before it reaches the database. */
export const maxSearchLength = 120;

/** Rows per page. */
export const pageSize = 50;

export interface DirectorySearchParams {
  q?: string;
  stage?: string;
  owner?: string;
  page?: string;
  /** "1" to include companies removed from the lifecycle; see lib/clients/removal.ts. */
  removed?: string;
}

/**
 * `%` and `_` are LIKE wildcards. Escaping them keeps the search literal, so a
 * company named "Wilson_Group" is findable and a typed `%` does not silently
 * turn into "match everything". Mirrors the proposals list.
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

/**
 * Builds the PostgREST `or` filter for a free-text company search.
 *
 * PostgREST parses `or=(...)` as a grammar in which `,` separates terms, `.`
 * separates column/operator/value and `)` closes the group — so a raw search
 * term is not inert data, it is syntax. A company called "Reyes, Ltd." or a
 * malicious `)` would otherwise rewrite the filter.
 *
 * The value is therefore wrapped in double quotes, which is PostgREST's own
 * mechanism for values containing separators, and any `"` or `\` inside it is
 * backslash-escaped so the term cannot close its own quoting. This is why the
 * caller must never interpolate a bare term into a filter itself.
 */
export function buildClientSearchFilter(term: string): string {
  const escaped = escapeLikePattern(term)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');
  const pattern = `"%${escaped}%"`;
  return ["name", "contact_name", "email", "owner"]
    .map((column) => `${column}.ilike.${pattern}`)
    .join(",");
}

/** Trims and caps a raw search term. Returns "" when there is nothing to search. */
export function sanitizeSearch(raw: string | undefined): string {
  return (raw ?? "").trim().slice(0, maxSearchLength);
}

/**
 * A stage filter is only honoured when it is one of the twelve real stages, so
 * an arbitrary query string cannot reach the database as a filter value.
 */
export function resolveStageFilter(raw: string | undefined): string {
  return lifecycleStages.includes(raw as (typeof lifecycleStages)[number]) ? (raw as string) : "";
}

/** Page numbers are 1-based; anything unparseable or below 1 falls back to page 1. */
export function resolvePage(raw: string | undefined): number {
  const parsed = Number.parseInt(raw ?? "1", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

/** Rebuilds the directory URL, omitting empty params so clean links stay clean. */
export function buildDirectoryHref(params: DirectorySearchParams): string {
  const query = new URLSearchParams();
  if (params.q) query.set("q", params.q);
  if (params.stage) query.set("stage", params.stage);
  if (params.owner) query.set("owner", params.owner);
  if (params.page && params.page !== "1") query.set("page", params.page);
  // Carried through paging and clearing, so "Show removed" survives a page turn
  // instead of silently hiding the rows the viewer just went looking for.
  if (params.removed === "1") query.set("removed", "1");
  const suffix = query.toString();
  return suffix ? `/employee/clients?${suffix}` : "/employee/clients";
}

/**
 * True once the viewer has narrowed the directory, which changes the empty-state
 * copy. `removed` is not a narrowing filter — it widens the list — so it is
 * excluded: "no companies match these filters" would be the wrong message for a
 * viewer who has only asked to see more.
 */
export function hasActiveFilters(params: { search: string; stage: string; owner: string }): boolean {
  return Boolean(params.search || params.stage || params.owner);
}
