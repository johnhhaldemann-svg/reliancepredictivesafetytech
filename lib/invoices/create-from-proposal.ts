import "server-only";

// Raises a draft invoice from a proposal, at whatever point in its life the
// caller asks — not just at acceptance. Unlike acceptance-income.ts this is a
// direct user action (there is a button for it), not a best-effort side
// effect of another event, so it reports its errors instead of swallowing
// them.
//
// Runs on the service-role client for the same reason acceptance-income.ts
// does: every value it writes is derived server-side from the proposal's own
// saved fee table, never from a number the caller posted, so a session-scoped
// client buys no extra safety here — it would only add the header UPDATE gap
// client_invoices' RLS deliberately leaves for admins to close (see
// lib/invoices/draft.ts).

import { createAdminClient } from "@/lib/supabase/admin";
import { isGeneratorState } from "@/lib/proposals/generator-state";
import { computeProposalTotals, type ProposalLineItem, type ProposalTotals } from "@/lib/proposals/pricing";
import { lookupService } from "@/lib/proposals/catalog";
import { recordAuditEvent, buildDataAuditEvent } from "@/lib/audit/events";
import { invoiceKinds, type InvoiceKind, type LineQtyBasis } from "@/lib/invoices/invoice";

/**
 * Catalog group, shortened to a one-word (or short) heading. A line whose
 * category is known prints as two lines — the category, then the specific
 * item, e.g. "Training" over "First Aid / CPR / AED Training" — rather than
 * just the bare name, so a client scanning the invoice sees what kind of
 * thing each line is without reading every description.
 */
const CATEGORY_LABELS: Record<string, string> = {
  "Platform & Licensing": "Platform",
  "Implementation & Consulting": "Implementation",
  "Safety Documents & Programs": "Safety Document",
  "Training Catalog": "Training",
  "Audits & Field Support": "Audit",
  "Travel & Expenses": "Travel",
  Custom: "Service",
};

/**
 * The two-line description an invoice line prints, when the row's category
 * is known. Only "service" rows carry a catalog group (packages and phases
 * don't), and only a catalog key resolves one — a hand-typed custom service
 * has no group to look up, so it stays a single line, same as before.
 */
function describeLine(row: ProposalLineItem): string {
  if (row.source !== "service") return row.name || row.desc || "Line item";

  const group = lookupService(row.key)?.group;
  const category = group ? CATEGORY_LABELS[group] : null;

  return category ? `${category}\n${row.name}` : row.name || row.desc || "Line item";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LooseClient = any;

export interface CreateInvoiceFromProposalInput {
  proposalId: string;
  kind: InvoiceKind;
  actorUserId: string;
  actorRole: string | null;
}

export interface CreateInvoiceFromProposalResult {
  ok: boolean;
  error?: string;
  invoiceId?: string;
  invoiceNumber?: string | null;
}

/** Exported for unit testing — the arithmetic that decides what a generated invoice bills. */
export function amountForKind(kind: InvoiceKind, totals: { total: number; deposit: number } | null, fallbackTotal: number) {
  if (!totals) {
    return kind === "full" ? fallbackTotal : 0;
  }

  if (kind === "deposit") return totals.deposit;
  if (kind === "balance") return Math.round((totals.total - totals.deposit) * 100) / 100;
  return totals.total;
}

interface DraftLine {
  description: string;
  quantity: number;
  unit_amount: number;
  line_total: number;
  unit: string;
  qty_basis: LineQtyBasis;
  sort_order: number;
}

/**
 * A count that doesn't matter numerically (qty === 1) gets 'flat' — simplest
 * to read. Anything that actually scales gets a basis that multiplies, so a
 * later edit through lib/invoices/draft.ts (lineTotalFor) recomputes the same
 * total this insert wrote. The specific label (hour/session/attendee) is
 * cosmetic beyond that; the printed Unit column carries the proposal's own
 * free-text unit regardless of which multiplying basis was picked.
 */
/** Exported for unit testing. */
export function qtyBasisFor(unit: string, qty: number): LineQtyBasis {
  if (qty === 1) return "flat";
  const u = unit.toLowerCase();
  if (u.includes("hour")) return "hour";
  if (u.includes("session")) return "session";
  return "attendee";
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Full amount: one invoice line per proposal fee-table row (package, phases,
 * services) rather than a single lump sum, so the client sees the same
 * breakdown the proposal itself printed. A proposal-level discount has no
 * column to land in on client_invoice_line_items — unit_amount and line_total
 * are both CHECK >= 0, so a negative "discount" row is not possible — instead
 * every line's price is scaled down by the same factor the discount removes
 * from the subtotal, keeping Σ(line_total) equal to the discounted subtotal
 * and total = subtotal + tax_amount equal to the proposal's own total.
 *
 * Deposit and balance are NOT itemized: a deposit is a percentage of
 * everything, not a subset of specific lines, so one summary line is more
 * honest than pretending it maps to particular services (matches
 * lib/proposals/income-schedule.ts's own "Deposit due" / "Balance due" rows).
 */
/** Exported for unit testing. */
export function buildFullLines(totals: ProposalTotals, reference: string): { lines: DraftLine[]; subtotal: number; tax: number } {
  const subtotalRaw = totals.lineItems.reduce((sum, row) => sum + row.amount, 0);
  const scale = totals.discount > 0 && subtotalRaw > 0 ? (subtotalRaw - totals.discount) / subtotalRaw : 1;

  const lines: DraftLine[] = totals.lineItems.map((row, index) => {
    const qty = row.qty > 0 ? row.qty : 1;
    const unitAmount = round2(row.price * scale);
    const lineTotal = round2(row.amount * scale);

    return {
      description: describeLine(row).slice(0, 500),
      quantity: qty,
      unit_amount: unitAmount,
      line_total: lineTotal,
      unit: (row.unit || "").slice(0, 60),
      qty_basis: qtyBasisFor(row.unit || "", qty),
      sort_order: (index + 1) * 10,
    };
  });

  if (lines.length === 0) {
    lines.push({
      description: `Full amount — ${reference}`.slice(0, 500),
      quantity: 1,
      unit_amount: round2(totals.total - totals.tax),
      line_total: round2(totals.total - totals.tax),
      unit: "",
      qty_basis: "flat",
      sort_order: 100,
    });
  }

  const subtotal = round2(lines.reduce((sum, line) => sum + line.line_total, 0));
  return { lines, subtotal, tax: totals.tax };
}

function buildSingleLine(description: string, amount: number): { lines: DraftLine[]; subtotal: number; tax: number } {
  return {
    lines: [{ description: description.slice(0, 500), quantity: 1, unit_amount: amount, line_total: amount, unit: "", qty_basis: "flat", sort_order: 100 }],
    subtotal: amount,
    tax: 0,
  };
}

export async function createInvoiceFromProposal(
  input: CreateInvoiceFromProposalInput,
): Promise<CreateInvoiceFromProposalResult> {
  if (!invoiceKinds.includes(input.kind)) {
    return { ok: false, error: "Unknown invoice kind." };
  }

  const db: LooseClient | null = createAdminClient();
  if (!db) return { ok: false, error: "Service-role credentials are not configured." };

  const { data: proposal, error: proposalError } = await db
    .from("client_proposals")
    .select("id, title, proposal_number, client_id, proposal_value, form_data")
    .eq("id", input.proposalId)
    .maybeSingle();
  if (proposalError || !proposal) {
    return { ok: false, error: proposalError?.message ?? "Proposal not found." };
  }

  const clientId = (proposal.client_id as string | null) ?? null;
  if (!clientId) {
    return { ok: false, error: "This proposal has no client assigned yet — assign one before raising an invoice." };
  }

  const state = proposal.form_data;
  const totals = isGeneratorState(state) ? computeProposalTotals(state) : null;
  const fallbackTotal = proposal.proposal_value != null ? Number(proposal.proposal_value) : 0;
  const amount = amountForKind(input.kind, totals, fallbackTotal);

  if (!(amount > 0)) {
    const error =
      input.kind === "deposit"
        ? "This proposal's fee table has no deposit percentage set, so there is nothing to bill as a deposit."
        : input.kind === "balance"
          ? "There is no balance left to bill — the deposit already covers the full amount, or the proposal has no saved fee table."
          : "This proposal has no priced total yet, so there is nothing to invoice.";
    return { ok: false, error };
  }

  const reference = [proposal.proposal_number, proposal.title].filter(Boolean).join(" — ") || "Proposal";

  const draft =
    input.kind === "full" && totals
      ? buildFullLines(totals, reference)
      : buildSingleLine(`${input.kind === "deposit" ? "Deposit" : input.kind === "balance" ? "Balance due" : "Full amount"} — ${reference}`, amount);

  const { data: invoice, error: insertError } = await db
    .from("client_invoices")
    .insert({
      client_id: clientId,
      proposal_id: input.proposalId,
      status: "draft",
      kind: input.kind,
      currency: "USD",
      subtotal: draft.subtotal,
      tax_amount: draft.tax,
      total: round2(draft.subtotal + draft.tax),
      job_name: proposal.title ?? null,
      /*
       * Left EMPTY on purpose.
       *
       * `notes` is printed under a NOTES heading on the client's invoice, by
       * both renderers. It used to be auto-filled with "Generated from
       * <proposal>. Tax, if any, is already folded into the proposal's total —
       * adjust the line items if this invoice needs its own tax treatment." —
       * an internal provenance note and an instruction addressed to whoever was
       * drafting, both landing in front of the client. That is what "the notes
       * comment at the bottom of the invoice needs work" meant (Steve,
       * 2026-08-31).
       *
       * The provenance is not lost: proposal_id links the two, the ledger and
       * the invoice screen both show "Raised from <proposal>", and the audit
       * trail records the creation. The tax caveat now sits beside the tax
       * field in the editor, where the person who can act on it will read it.
       * What remains here is a blank space for the seller to write something
       * the client should actually read.
       */
      notes: null,
      created_by: input.actorUserId,
    })
    .select("id, invoice_number")
    .single();

  if (insertError) {
    if (insertError.code === "23505") {
      return {
        ok: false,
        error: `A live ${input.kind} invoice already exists for this proposal. Void it first, or generate a different kind.`,
      };
    }
    return { ok: false, error: insertError.message };
  }

  const { error: lineError } = await db.from("client_invoice_line_items").insert(
    draft.lines.map((line) => ({ ...line, invoice_id: invoice.id })),
  );

  if (lineError) {
    // Don't leave a lineless invoice sitting in the ledger — undo the header too.
    await db.from("client_invoices").delete().eq("id", invoice.id);
    return { ok: false, error: lineError.message };
  }

  await recordAuditEvent({
    ...buildDataAuditEvent(
      "create",
      "client_invoice",
      invoice.id as string,
      input.actorUserId,
      `Raised a ${input.kind} invoice${invoice.invoice_number ? ` ${invoice.invoice_number}` : ""} from ${reference} (${draft.lines.length} line${draft.lines.length === 1 ? "" : "s"})`,
      null,
      { proposal_id: input.proposalId, client_id: clientId, kind: input.kind, amount, lines: draft.lines.length },
    ),
    actor_role: input.actorRole,
  });

  return { ok: true, invoiceId: invoice.id as string, invoiceNumber: (invoice.invoice_number as string | null) ?? null };
}
