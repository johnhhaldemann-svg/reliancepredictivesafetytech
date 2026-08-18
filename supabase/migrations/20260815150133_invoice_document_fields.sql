alter table public.client_invoices
  add column if not exists consultant_name text
    check (consultant_name is null or char_length(consultant_name) <= 200),
  add column if not exists job_name text
    check (job_name is null or char_length(job_name) <= 300),
  add column if not exists payment_terms text
    check (payment_terms is null or char_length(payment_terms) <= 1000),
  add column if not exists client_agreement_ref text
    check (client_agreement_ref is null or char_length(client_agreement_ref) <= 120),
  add column if not exists prepared_by text
    check (prepared_by is null or char_length(prepared_by) <= 200),
  add column if not exists tax_amount numeric(14, 2) not null default 0
    check (tax_amount >= 0);

comment on column public.client_invoices.consultant_name is
  'Who delivered the work this invoice bills for, as the client should see it printed. A person, not the account owner and not a role.';
comment on column public.client_invoices.job_name is
  'The client''s name for the job or site this invoice covers, so an accounts-payable clerk can match it to their own record without opening the contract.';
comment on column public.client_invoices.payment_terms is
  'The terms in words, printed verbatim ("Net 30 from invoice date", "Due upon receipt"). The DATE the invoice is due is due_date; this is the clause, and the two are set together so the document cannot contradict itself.';
comment on column public.client_invoices.client_agreement_ref is
  'The CLIENT''s own agreement, contract or purchase-order number, if they issue one — never ours. Many clients will not pay an invoice that does not quote their PO number back at them. Our own references are invoice_number and the linked proposal''s proposal_number; do not put either here.';
comment on column public.client_invoices.prepared_by is
  'Who prepared this invoice, for the document. The AUDITABLE answer is created_by / issued_by, which are auth.users references a person cannot type over; this is the printed courtesy line and is not evidence of anything.';
comment on column public.client_invoices.tax_amount is
  'Tax added to the line subtotal. The invariant the application maintains is total = subtotal + tax_amount, recomputed server-side from the stored lines on every edit (see updateDraftInvoiceLines). Not a rate: a rate would have to be re-derived on every read and would drift from what the client was actually charged.';

alter table public.client_invoice_line_items
  add column if not exists unit text not null default ''
    check (char_length(unit) <= 60),
  add column if not exists qty_basis text not null default 'flat'
    check (qty_basis in ('session', 'attendee', 'hour', 'flat')),
  add column if not exists service_date date;

comment on column public.client_invoice_line_items.unit is
  'What one of this line is, as printed: "Seat", "Session", "Hour", "Mile". Free text and stored on the line rather than looked up, so a repriced or renamed catalog cannot relabel an invoice already raised.';
comment on column public.client_invoice_line_items.qty_basis is
  'Whether quantity multiplies unit_amount. session/attendee/hour scale — 10 attendees at 105.00 is 1050.00. flat does NOT — a fixed fee stays at unit_amount whatever the quantity says, so a stray 2 in the quantity box cannot double a retainer. Enforced in lib/invoices/draft.ts (lineTotalFor), never trusted from the browser.';
comment on column public.client_invoice_line_items.service_date is
  'The day this line was delivered, when it was delivered on one — the date a client matches against their own attendance sheet. Null for lines that have no single day.';