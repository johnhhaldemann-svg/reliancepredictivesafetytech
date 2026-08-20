import { NextResponse } from "next/server";
import { getInvoiceAccess } from "@/lib/invoices/access";
import { invoiceKindLabel, invoiceStatusLabel } from "@/lib/invoices/invoice";
import { loadCompanyProfile } from "@/lib/proposals/company-server";
import { buildInvoiceDocumentModel } from "@/lib/invoices/document-model";
import { invoiceDownloadFilename } from "@/lib/invoices/downloads";
import { renderInvoicePdf } from "@/lib/invoices/pdf";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LooseClient = any;

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, canSeeMoney } = await getInvoiceAccess();
  if (!supabase || !isUuid(id)) return new NextResponse("Not found", { status: 404 });
  if (!canSeeMoney) return new NextResponse("Forbidden", { status: 403 });

  const { data: invoice } = await (supabase as LooseClient)
    .from("client_invoices")
    .select(
      "invoice_number, status, kind, issue_date, due_date, currency, subtotal, tax_amount, total, client_id, job_name, consultant_name, payment_terms, client_agreement_ref, prepared_by, notes",
    )
    .eq("id", id)
    .maybeSingle();
  if (!invoice) return new NextResponse("Not found", { status: 404 });

  const [{ data: lines }, { data: client }] = await Promise.all([
    supabase
      .from("client_invoice_line_items")
      .select("description, quantity, unit_amount, line_total, unit")
      .eq("invoice_id", id)
      .order("sort_order", { ascending: true }),
    invoice.client_id
      ? supabase
          .from("company_clients")
          .select("id, name, address_line1, address_line2, city, state, postal_code, country")
          .eq("id", invoice.client_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const seller = await loadCompanyProfile(supabase);

  try {
    const model = buildInvoiceDocumentModel({
      invoice,
      lines: (lines ?? []) as LooseClient[],
      seller,
      billTo: (client as LooseClient) ?? null,
      statusLabel: invoiceStatusLabel(invoice.status),
      kindLabel: invoiceKindLabel(invoice.kind),
    });

    const bytes = await renderInvoicePdf(model);
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${invoiceDownloadFilename(model.invoiceNumber, "pdf")}"`,
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch {
    return new NextResponse("Could not generate the invoice PDF.", { status: 500 });
  }
}
