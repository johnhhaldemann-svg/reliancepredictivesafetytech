-- The signature survives a reopen, and a price change has somewhere to go that
-- is not the signed proposal.
--
-- MODULE_ID: client_proposals, client_invoices
--
-- WHY. Agreed by Steve Sladky and Custin on 2026-08-31 and restated by John:
-- **a signed proposal is never edited; the invoice carries the price change.**
-- Two things in the platform contradicted that.
--
-- 1. REOPENING A SIGNED PROPOSAL DESTROYED THE SIGNATURE.
--    updateProposalStatus() nulls accepted_at, accepted_by_name,
--    accepted_by_email, acceptance_ip and accepted_revision_id on the way back
--    to draft. It has a real reason — the share-link writers gate on
--    `accepted_at is null`, so without the reset a proposal could never be
--    accepted a second time — but the effect is that the evidence of the first
--    acceptance is gone for good. The workflow Custin taught Steve (save the
--    revision as a draft, then generate the invoice) runs straight through it.
--
--    Rather than fight the reset, this makes it harmless: every acceptance is
--    copied into an append-only ledger the moment it happens. The working
--    columns still describe the CURRENT round and still reset; the ledger keeps
--    every round that ever closed. Captured by TRIGGER, not by the application,
--    so the share link, DocuSign and any future path are all covered and none of
--    them can forget.
--
--    Nothing has been lost yet: as of 2026-09-01 no proposal in this database
--    has ever been accepted through the platform, so the ledger starts empty and
--    correct rather than backfilled from destroyed data.
--
-- 2. A COST INCREASE HAD NOWHERE TO GO BUT THE SIGNED PROPOSAL.
--    guard_client_invoice_total() refuses an invoice that would push the total
--    above the proposal's contract value, hinting "Void or reprice an existing
--    invoice, or raise the proposal value." Raising the proposal value is
--    editing the signed document — the one thing the 2026-08-31 meeting ruled
--    out. A reduction (Steve's $880 against a $880 proposal) passes; the
--    opposite had no legitimate path at all.
--
--    DECISION (John Haldemann, 2026-09-01, "make the logical one"): the invoice
--    may exceed the signed value, but only while it says why. A new
--    variance_reason on client_invoices is that explanation, and the guard now
--    refuses only an unexplained overage. This is the smallest honest shape for
--    the "additional cost request" the meeting left unnamed: it keeps the
--    signed proposal untouched, puts the reason on the document that actually
--    changed, and leaves a written record on the invoice rather than in
--    somebody's memory. A richer change-order document can still be layered on
--    later; it would read this same field.
--
-- ADDITIVE AND REVERSIBLE. One new table, one new column, one new trigger, one
-- function replaced. No existing row is rewritten.
--
-- ROLLBACK:
--   drop trigger if exists capture_client_proposal_signature on public.client_proposals;
--   drop function if exists public.capture_client_proposal_signature();
--   drop table if exists public.client_proposal_signatures;
--   alter table public.client_invoices drop column if exists variance_reason;
--   -- then restore guard_client_invoice_total()'s unconditional raise:
--   --   if v_live > v_value then raise exception ... end if;

-- ---------------------------------------------------------------------------
-- 1. The signature ledger.
-- ---------------------------------------------------------------------------

create table if not exists public.client_proposal_signatures (
  id              uuid primary key default gen_random_uuid(),
  proposal_id     uuid not null references public.client_proposals(id) on delete cascade,
  revision_id     uuid references public.client_proposal_revisions(id) on delete set null,
  -- Copies, not joins: the point of this table is to still be true after the
  -- proposal is renumbered, retitled, repriced or reopened.
  proposal_number text,
  proposal_title  text,
  proposal_value  numeric(14, 2),
  signer_name     text,
  signer_email    text,
  signer_ip       text,
  signed_at       timestamptz not null,
  created_at      timestamptz not null default now()
);

create index if not exists client_proposal_signatures_proposal_idx
  on public.client_proposal_signatures (proposal_id, signed_at desc);

comment on table public.client_proposal_signatures is
  'Append-only record of every acceptance a proposal has ever received. Written only by capture_client_proposal_signature(); reopening a proposal clears client_proposals'' acceptance columns but can never touch a row here. The values are copied rather than joined so the record stays true after the proposal is renumbered, retitled or repriced.';

alter table public.client_proposal_signatures enable row level security;

-- Readable by employees; writable by nothing. The capture trigger is SECURITY
-- DEFINER and owned by the table owner, so it writes without a policy.
drop policy if exists "Employees read proposal signatures" on public.client_proposal_signatures;
create policy "Employees read proposal signatures"
  on public.client_proposal_signatures
  for select
  using (public.is_company_portal_employee());

revoke insert, update, delete on public.client_proposal_signatures from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Capture, on every path.
-- ---------------------------------------------------------------------------

create or replace function public.capture_client_proposal_signature()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  -- Only the null -> not-null transition. A second UPDATE that leaves
  -- accepted_at where it was must not mint a duplicate signature.
  if new.accepted_at is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.accepted_at is not distinct from new.accepted_at then
    return new;
  end if;

  insert into public.client_proposal_signatures (
    proposal_id, revision_id, proposal_number, proposal_title, proposal_value,
    signer_name, signer_email, signer_ip, signed_at
  )
  values (
    new.id, new.accepted_revision_id, new.proposal_number, new.title, new.proposal_value,
    new.accepted_by_name, new.accepted_by_email, new.acceptance_ip, new.accepted_at
  );

  return new;
end $$;

revoke execute on function public.capture_client_proposal_signature() from public, anon, authenticated;

comment on function public.capture_client_proposal_signature() is
  'AFTER INSERT OR UPDATE on client_proposals: copies an acceptance into client_proposal_signatures the moment accepted_at goes from null to set. Fires for every acceptance path — share link, DocuSign, manual — so no caller can forget, and reopening the proposal afterwards cannot erase what was signed.';

drop trigger if exists capture_client_proposal_signature on public.client_proposals;
create trigger capture_client_proposal_signature
after insert or update of accepted_at on public.client_proposals
for each row execute function public.capture_client_proposal_signature();

-- ---------------------------------------------------------------------------
-- 3. An invoice may differ from the signed value — while it says why.
-- ---------------------------------------------------------------------------

alter table public.client_invoices
  add column if not exists variance_reason text;

alter table public.client_invoices
  drop constraint if exists client_invoices_variance_reason_length;
alter table public.client_invoices
  add constraint client_invoices_variance_reason_length
  check (variance_reason is null or char_length(variance_reason) <= 2000);

comment on column public.client_invoices.variance_reason is
  'Why this invoice differs from the signed proposal''s value — "six attendees, not twelve", "additional day requested on site". Required by guard_client_invoice_total() before invoices against a proposal may exceed its contract value, because the alternative (editing the signed proposal) is forbidden by the decision of record of 2026-08-31.';

create or replace function public.guard_client_invoice_total()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_value numeric(14, 2);
  v_live  numeric(14, 2);
begin
  if new.proposal_id is null or new.status = 'void' then
    return new;
  end if;

  select proposal_value into v_value
    from public.client_proposals
   where id = new.proposal_id
     for update;

  if v_value is null or v_value <= 0 then
    return new;
  end if;

  select coalesce(sum(total), 0) into v_live
    from public.client_invoices
   where proposal_id = new.proposal_id
     and status <> 'void';

  -- An overage is allowed, but never silently: the signed proposal is not ours
  -- to edit, so the explanation lives on the invoice that actually changed.
  if v_live > v_value and coalesce(btrim(new.variance_reason), '') = '' then
    raise exception
      'invoices against this proposal would total %, above its signed value of %',
      v_live, v_value
      using errcode = 'check_violation',
            hint = 'The signed proposal is never edited to fit an invoice. Record why this invoice differs in its "Why this differs from the proposal" field and save again — or void/reprice an existing invoice.';
  end if;

  return new;
end $$;

comment on function public.guard_client_invoice_total() is
  'AFTER INSERT OR UPDATE on client_invoices: refuses to let invoices against a proposal exceed its signed value UNLESS the invoice records a variance_reason. Editing the proposal to fit is deliberately not offered — decision of record, Steve Sladky / Custin, 2026-08-31.';

drop trigger if exists guard_client_invoice_total on public.client_invoices;
create trigger guard_client_invoice_total
after insert or update of total, status, proposal_id, variance_reason on public.client_invoices
for each row execute function public.guard_client_invoice_total();
