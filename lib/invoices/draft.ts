import "server-only";

// The draft invoice editor's write path — named by the 15/18 August migrations'
// column comments (lineTotalFor, updateDraftInvoiceLines) before any editor
// existed to call them.
//
// Runs on the service-role client for one narrow reason: client_invoice_line_items
// is writable by any drafting employee under RLS, but client_invoices UPDATE is
// admin-only ("Admins can settle invoices"), so the header subtotal/total this
// function keeps in sync with whatever lines were just saved cannot be written
// back by that same employee's session. The invoice must already be status
// 'draft' (checked below) and every figure is derived from the lines the
// caller posted for THIS invoice — this closes the header-sync gap the column
// comment anticipated, it does not grant a new capability.

import { createAdminClient } from "@/lib/supabase/admin";
import { lineQtyBases, type LineQtyBasis } from "./invoice";

/** client_invoices / client_invoice_line_items predate the generated Database types (see app/employee/invoices/page.tsx). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LooseClient = any;

export interface DraftInvoiceLineInput {
  description: string;
  quantity: number | string;
  unit_amount: number | string;
  unit?: string | null;
  qty_basis?: string | null;
  service_date?: string | null;
  sort_order?: number;
}

export interface UpdateDraftInvoiceLinesResult {
  ok: boolean;
  error?: string;
  totals?: { subtotal: number; tax: number; total: number };
}

/**
 * A line's total, respecting qty_basis. session/attendee/hour scale with
 * quantity; flat does not — a flat fee is unit_amount regardless of what the
 * quantity box says, so a stray 2 cannot double a retainer (see the qty_basis
 * column comment on client_invoice_line_items).
 */
export function lineTotalFor(line: { quantity: number | string; unit_amount: number | string; qty_basis?: string | null }): number {
  const qty = Number(line.quantity) || 0;
  const unitAmount = Number(line.unit_amount) || 0;
  const basis = (line.qty_basis ?? "flat") as LineQtyBasis;
  const multiplier = basis === "flat" ? 1 : qty;

  return Math.round(multiplier * unitAmount * 100) / 100;
}

/** Replaces a draft invoice's line items and recomputes subtotal/total. */
export async function updateDraftInvoiceLines(
  invoiceId: string,
  lines: DraftInvoiceLineInput[],
): Promise<UpdateDraftInvoiceLinesResult> {
  const db: LooseClient | null = createAdminClient();
  if (!db) return { ok: false, error: "Service-role credentials are not configured." };

  const { data: invoice, error: invoiceError } = await db
    .from("client_invoices")
    .select("id, status, tax_amount")
    .eq("id", invoiceId)
    .maybeSingle();
  if (invoiceError || !invoice) return { ok: false, error: invoiceError?.message ?? "Invoice not found." };
  if (invoice.status !== "draft") {
    return { ok: false, error: "Only a draft invoice's line items can be changed." };
  }

  const cleaned = lines
    .map((line, index) => ({
      description: (line.description ?? "").trim(),
      quantity: Number(line.quantity) || 0,
      unit_amount: Number(line.unit_amount) || 0,
      unit: (line.unit ?? "").slice(0, 60),
      qty_basis: (lineQtyBases as readonly string[]).includes(line.qty_basis ?? "") ? (line.qty_basis as LineQtyBasis) : "flat",
      service_date: line.service_date || null,
      sort_order: line.sort_order ?? (index + 1) * 10,
    }))
    .filter((line) => line.description.length > 0 && line.quantity > 0);

  if (cleaned.length === 0) {
    return { ok: false, error: "An invoice needs at least one line." };
  }

  const { error: deleteError } = await db.from("client_invoice_line_items").delete().eq("invoice_id", invoiceId);
  if (deleteError) return { ok: false, error: deleteError.message };

  const rows = cleaned.map((line) => ({
    invoice_id: invoiceId,
    description: line.description,
    quantity: line.quantity,
    unit_amount: line.unit_amount,
    unit: line.unit,
    qty_basis: line.qty_basis,
    service_date: line.service_date,
    sort_order: line.sort_order,
    line_total: lineTotalFor(line),
  }));

  const { error: insertError } = await db.from("client_invoice_line_items").insert(rows);
  if (insertError) return { ok: false, error: insertError.message };

  const subtotal = Math.round(rows.reduce((sum, row) => sum + row.line_total, 0) * 100) / 100;
  const tax = Math.round((Number(invoice.tax_amount) || 0) * 100) / 100;
  const total = Math.round((subtotal + tax) * 100) / 100;

  const { error: updateError } = await db.from("client_invoices").update({ subtotal, total }).eq("id", invoiceId);
  if (updateError) return { ok: false, error: updateError.message };

  return { ok: true, totals: { subtotal, tax, total } };
}
