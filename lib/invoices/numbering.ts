// The shapes a document number can take, as pure functions.
//
// The database allocates every real number — allocate_client_proposal_number()
// and allocate_client_invoice_number() are the only writers, and neither
// honours a caller-supplied value. These helpers exist so the application can
// SAY what a number will look like (a preview, a validation message, a test)
// without guessing, and so a change to the shape breaks a test here before it
// reaches a client's document.
//
// Decision of record (John Haldemann, 2026-09-01), resolving the conflict
// between the 2026-08-14 company_slug scheme and the 2026-08-19 client_code
// build review: `client_code` is the identifier. It is the moniker people
// actually say and type — Steve hand-wrote "Wondfo-2026-001" into the generator
// — and it is the one with a UI, validation and a suggestion helper behind it.
// `company_slug` is retained only so numbers already minted under it stay
// explicable.
//
// Invoice numbers hang off the parent proposal (Steve Sladky / Custin,
// 2026-08-31): proposal Wondfo-2026-002 raises Wondfo-2026-002-01, -02, -03.
// The sequence therefore restarts at 01 for every proposal by construction,
// which is what the "why does this say INV-07" complaint was really asking for.

import { normalizeClientCode } from "@/lib/proposals/client-codes";

/**
 * Zero-pad that GROWS rather than truncates.
 *
 * Mirrors `lpad(n, greatest(width, length(n)), '0')` in the SQL. A bare
 * padStart would be fine, but stating the intent here keeps the two
 * implementations reading the same: past the pad width the number simply gets
 * longer (Wondfo-2026-002-100), because a truncated sequence would mint a
 * duplicate reference.
 */
function pad(seq: number, width: number): string {
  const n = Math.max(1, Math.trunc(seq));
  return String(n).padStart(width, "0");
}

/**
 * An invoice raised against a proposal: `<proposal number>-NN`.
 *
 * The parent number is taken verbatim — whatever scheme it was minted under is
 * the scheme the invoice inherits, so the two documents always name the same
 * deal. Returns null when there is no parent number to hang off, which is the
 * caller's signal to use the standalone shape instead.
 */
export function formatProposalLinkedInvoiceNumber(
  proposalNumber: string | null | undefined,
  seq: number,
): string | null {
  const parent = typeof proposalNumber === "string" ? proposalNumber.trim() : "";
  if (parent === "") return null;
  return `${parent}-${pad(seq, 2)}`;
}

/**
 * An invoice with no proposal behind it: `<CODE>-YYYY-INV-NN`.
 *
 * The INV infix is what keeps a standalone invoice from colliding with a
 * proposal number for the same client and year.
 */
export function formatStandaloneInvoiceNumber(
  code: string,
  seq: number,
  year: number = new Date().getFullYear(),
): string {
  return `${normalizeClientCode(code)}-${year}-INV-${pad(seq, 2)}`;
}

/**
 * Splits `<parent>-NN` back into its parts, or null if the string is not
 * proposal-linked.
 *
 * Used to tell a proposal-linked invoice from a standalone one without a
 * database round trip — the same test the reclaim trigger makes in SQL when it
 * decides which counter a deleted draft's number belongs to.
 */
export function parseProposalLinkedInvoiceNumber(
  invoiceNumber: string | null | undefined,
): { proposalNumber: string; seq: number } | null {
  if (typeof invoiceNumber !== "string") return null;
  const match = /^(.+)-([0-9]+)$/.exec(invoiceNumber.trim());
  if (!match) return null;
  // A standalone number ends `-INV-NN`; its "parent" would be the client/year
  // stem, which is not a proposal. Reject it so the two shapes stay distinct.
  if (/-INV$/.test(match[1])) return null;
  return { proposalNumber: match[1], seq: Number(match[2]) };
}

/**
 * True when an invoice number carries the client's own identifier.
 *
 * The reason invoice numbering was cut loose from proposals on 2026-08-20 was
 * that a proposal created before its client had an identifier keeps the global
 * `RPS-` fallback for life, so the invoice inherited a prefix that named no
 * client at all. Re-linking them is only safe while this holds, so the check is
 * stated once, here, and enforced again in SQL.
 */
export function invoiceNumberNamesClient(invoiceNumber: string, code: string): boolean {
  const prefix = normalizeClientCode(code);
  if (prefix === "") return false;
  return invoiceNumber.toLowerCase().startsWith(`${prefix.toLowerCase()}-`);
}
