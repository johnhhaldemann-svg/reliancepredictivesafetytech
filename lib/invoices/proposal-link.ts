import { isOutstanding, type InvoiceRow } from "@/lib/invoices/invoice";

/**
 * How an invoice connects to the proposal that earned it.
 *
 * client_invoices.proposal_id has always existed and nothing has ever read it.
 * Two questions are worth answering from it, and they run in opposite
 * directions:
 *
 *   provenance — for an invoice, which proposal did this money come from?
 *   the gap    — for a won proposal, has anyone actually billed it?
 *
 * The second is the one that loses money. A proposal the client accepted and
 * nobody invoiced is revenue the business earned and never asked for, and
 * before this there was no screen anywhere that could show it.
 */

export type ProposalRow = {
  id: string;
  client_id: string | null;
  title: string | null;
  status: string | null;
  proposal_number: string | null;
  accepted_at: string | null;
};

/**
 * A proposal counts as won when the client accepted it. `accepted_at` is the
 * fact — a timestamp written when acceptance was captured — so it is trusted
 * over `status`, which is a workflow label a person can move by hand.
 */
export function isWonProposal(proposal: ProposalRow): boolean {
  return Boolean(proposal.accepted_at) || proposal.status === "accepted";
}

/** Invoices grouped by the proposal they were raised from. */
export function invoicesByProposal<T extends InvoiceRow & { proposal_id: string | null }>(
  invoices: T[],
): Map<string, T[]> {
  const byProposal = new Map<string, T[]>();

  for (const invoice of invoices) {
    if (!invoice.proposal_id) {
      continue;
    }

    const existing = byProposal.get(invoice.proposal_id);

    if (existing) {
      existing.push(invoice);
    } else {
      byProposal.set(invoice.proposal_id, [invoice]);
    }
  }

  return byProposal;
}

function amount(value: number | string | null | undefined): number {
  const n = typeof value === "string" ? Number(value) : (value ?? 0);

  return Number.isFinite(n) ? n : 0;
}

/**
 * What has been billed against a proposal. A void invoice is excluded: it was
 * withdrawn, so it neither owes nor collects, and counting it would make a
 * proposal look billed when nothing is outstanding.
 */
export function billedForProposal<T extends InvoiceRow>(invoices: T[]): { billed: number; outstanding: number; collected: number } {
  let billed = 0;
  let outstanding = 0;
  let collected = 0;

  for (const invoice of invoices) {
    if (invoice.status === "void") {
      continue;
    }

    const total = amount(invoice.total);
    billed += total;

    if (isOutstanding(invoice.status)) outstanding += total;
    if (invoice.status === "paid") collected += total;
  }

  const round = (n: number) => Math.round(n * 100) / 100;

  return { billed: round(billed), outstanding: round(outstanding), collected: round(collected) };
}

export type UnbilledProposal = { proposal: ProposalRow; voidedOnly: boolean };

/**
 * Won proposals nobody has billed.
 *
 * A proposal whose only invoices were voided is included, and flagged, because
 * that is not the same situation as one never invoiced at all — someone raised
 * a bill and pulled it, and it still needs a decision.
 */
export function proposalsReadyToInvoice<T extends InvoiceRow & { proposal_id: string | null }>(
  proposals: ProposalRow[],
  invoices: T[],
): UnbilledProposal[] {
  const byProposal = invoicesByProposal(invoices);

  return proposals.filter(isWonProposal).flatMap((proposal) => {
    const raised = byProposal.get(proposal.id) ?? [];
    const live = raised.filter((invoice) => invoice.status !== "void");

    if (live.length > 0) {
      return [];
    }

    return [{ proposal, voidedOnly: raised.length > 0 }];
  });
}

/** A proposal's display name, falling back through what it actually has. */
export function proposalLabel(proposal: ProposalRow): string {
  return proposal.proposal_number || proposal.title || "Untitled proposal";
}
