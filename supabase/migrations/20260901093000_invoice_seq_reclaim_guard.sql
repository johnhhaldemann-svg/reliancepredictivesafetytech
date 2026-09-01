-- Let a proposal's invoice_seq come back down when — and only when — nothing
-- is numbered above the new value.
--
-- MODULE_ID: client_proposals, client_invoices
--
-- WHY. guard_client_proposal_billing_fields() refuses any decrease of
-- client_proposals.invoice_seq: "Lowering it would re-mint invoice numbers that
-- already exist." The concern is exactly right and must not be dropped. The
-- check, however, is blanket, and 20260901090000 gave invoice numbers a
-- per-proposal sequence — so reclaim_client_invoice_number() now needs to
-- decrement invoice_seq when a never-issued draft holding the tail is deleted.
-- With the blanket guard in place that reclaim raises, and because the reclaim
-- runs inside the DELETE, **deleting a proposal-linked draft invoice fails
-- outright**:
--
--   ERROR: invoice_seq only moves forward (3 -> 2)
--   CONTEXT: PL/pgSQL function reclaim_client_invoice_number() ...
--            SQL statement "delete from public.client_invoices where id = ..."
--
-- Caught by a rolled-back rehearsal against production before any human hit it.
-- Deleting the old invoice and regenerating is the workflow Custin taught Steve
-- on 2026-08-31, so this would have blocked the exact path the numbering work
-- exists to serve.
--
-- The precise rule replaces the blunt one: lowering invoice_seq to N is refused
-- only when a surviving invoice for this proposal is numbered above N. The
-- reclaim trigger is AFTER DELETE, so the row it is reclaiming for is already
-- gone and is correctly not counted. A hand-edit that would strand a live
-- number is still refused, which is the property the original guard was
-- protecting.
--
-- The other two clauses (an issued proposal's number cannot change; a proposal's
-- value cannot drop below what is already invoiced) are carried over verbatim.
--
-- ADDITIVE AND REVERSIBLE. One function replaced.
--
-- ROLLBACK: restore the blanket check —
--   if new.invoice_seq < old.invoice_seq then
--     raise exception 'invoice_seq only moves forward (% -> %)', old.invoice_seq, new.invoice_seq
--       using errcode = 'check_violation',
--             hint = 'Lowering it would re-mint invoice numbers that already exist.';
--   end if;
--   -- note: this also re-breaks deletion of proposal-linked draft invoices.

create or replace function public.guard_client_proposal_billing_fields()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_live  numeric(14, 2);
  v_above integer;
begin
  if new.proposal_number is distinct from old.proposal_number
     and old.status is distinct from 'draft' then
    raise exception
      'proposal % is %, and an issued document''s number cannot change', old.proposal_number, old.status
      using errcode = 'check_violation',
            hint = 'Only drafts are renumbered. The client holds this number on the document they were sent.';
  end if;

  -- Lowering is safe exactly when no surviving invoice for this proposal is
  -- numbered above the new value; then the sequence cannot re-mint anything.
  if new.invoice_seq < old.invoice_seq then
    select count(*) into v_above
      from public.client_invoices i
     where i.proposal_id = old.id
       and old.proposal_number is not null
       and i.invoice_number is not null
       and left(i.invoice_number, length(old.proposal_number) + 1) = old.proposal_number || '-'
       and substring(i.invoice_number from length(old.proposal_number) + 2) ~ '^[0-9]+$'
       and substring(i.invoice_number from length(old.proposal_number) + 2)::integer > new.invoice_seq;

    if v_above > 0 then
      raise exception
        'invoice_seq cannot drop to % while % invoice(s) against this proposal are numbered above it',
        new.invoice_seq, v_above
        using errcode = 'check_violation',
              hint = 'Lowering it would re-mint invoice numbers that already exist. Delete or void those invoices first.';
    end if;
  end if;

  if new.proposal_value is not null
     and new.proposal_value < coalesce(old.proposal_value, 0) then
    select coalesce(sum(total), 0) into v_live
      from public.client_invoices
     where proposal_id = old.id
       and status <> 'void';

    if v_live > new.proposal_value then
      raise exception
        'live invoices against this proposal already total %, so its value cannot drop to %', v_live, new.proposal_value
        using errcode = 'check_violation',
              hint = 'Void or reprice the invoices first.';
    end if;
  end if;

  return new;
end $$;

comment on function public.guard_client_proposal_billing_fields() is
  'BEFORE UPDATE on client_proposals: an issued proposal''s number is immutable; invoice_seq may only drop when no surviving invoice for the proposal is numbered above the new value (which is what lets reclaim_client_invoice_number() return a deleted draft''s number); and proposal_value may not fall below what is already invoiced.';
