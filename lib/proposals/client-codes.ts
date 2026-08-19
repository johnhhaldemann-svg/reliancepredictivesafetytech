// The client-code moniker behind per-client document numbers (Wondfo-2026-001).
//
// Pure functions only — no Supabase, no I/O — importable from both the client
// forms and the server actions. The database side is
// supabase/migrations/20260819134239_client_document_numbering.sql: the CHECK
// constraint there and `clientCodePattern` here must agree.
//
// Decision of record (build review, 2026-08-19): the code moved from a 2-3
// letter shouted abbreviation (WFU) to the moniker people actually use for the
// company (Wondfo), case preserved as typed. Assigned by whoever writes the
// client's first proposal, unique across clients (case-insensitively).
// Document numbers are CODE-YYYY-NNN, restarting the sequence each January.

/** Mirrors company_clients_client_code_format in the migration. */
export const clientCodePattern = /^[A-Za-z][A-Za-z0-9]{1,23}$/;

export const clientCodeRule =
  "2–24 letters or numbers, starting with a letter — the moniker people actually use for this company, e.g. Wondfo. Case is kept as typed.";

/** Trims; returns "" for non-strings. Case is preserved. Does NOT validate. */
export function normalizeClientCode(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function isValidClientCode(value: unknown): boolean {
  return clientCodePattern.test(normalizeClientCode(value));
}

/**
 * CODE-YYYY-NNN, zero-padded to three digits, defaulting to the current year.
 *
 * greatest(3, …) in SQL and this guard are the same rule: past sequence 999 the
 * number simply grows (Wondfo-2026-1000) — a bare three-char pad would
 * TRUNCATE and mint a duplicate reference.
 */
export function formatClientProposalNumber(code: string, seq: number, year: number = new Date().getFullYear()): string {
  const n = Math.max(1, Math.trunc(seq));
  return `${normalizeClientCode(code)}-${year}-${String(n).padStart(3, "0")}`;
}

/** Alphanumeric runs that start with a letter — the only shape a code can be. */
function nameWords(name: string): string[] {
  return name
    .split(/[^A-Za-z0-9]+/)
    .filter((word) => word !== "" && /^[A-Za-z]/.test(word));
}

/**
 * A suggested moniker for a company name — a starting point the assigner can
 * overtype, never an automatic assignment.
 *
 * The moniker is the name people actually use for the company, not initials:
 * "Wondfo USA" suggests "Wondfo". On a collision it falls back to the first
 * two words joined ("StaffElectric"), then a numbered variant of the first
 * word ("Wondfo2"). Case is taken as typed in the company name. Returns "" when
 * the name yields no valid, untaken candidate.
 */
export function suggestClientCode(name: unknown, taken: Iterable<string> = []): string {
  if (typeof name !== "string") return "";
  const words = nameWords(name);
  if (words.length === 0) return "";

  const takenSet = new Set<string>();
  for (const code of taken) {
    const normalized = normalizeClientCode(code).toLowerCase();
    if (normalized) takenSet.add(normalized);
  }

  const candidates: string[] = [words[0].slice(0, 24)];
  if (words.length >= 2) candidates.push(`${words[0]}${words[1]}`.slice(0, 24));
  for (let suffix = 2; suffix <= 9; suffix += 1) {
    candidates.push(`${words[0].slice(0, 23)}${suffix}`);
  }

  for (const candidate of candidates) {
    if (clientCodePattern.test(candidate) && !takenSet.has(candidate.toLowerCase())) return candidate;
  }
  return "";
}
