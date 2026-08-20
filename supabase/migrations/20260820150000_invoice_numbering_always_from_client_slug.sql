-- Invoice numbers always come from the client's own slug — never inherited
-- from the parent proposal's number.
--
-- MODULE_ID: client_invoices
--
-- WHY. allocate_client_invoice_number() (20260818220234, restored verbatim by
-- 20260819172603 after the PR #4 regression) tried the proposal first: a
-- proposal-linked invoice took PROPOSAL_NUMBER-NN, and only a standalone
-- invoice used the client's company_slug. That inherits whatever prefix the
-- proposal happened to get — including the global RPS- fallback a proposal
-- keeps for life if it was created before its client had a slug assigned,
-- since an issued proposal number is never rewritten.
--
-- Confirmed live in production on 2026-08-20: invoice
-- 66ffa700-f214-4e29-bb4d-2b6b5fb4193e read RPS-2026-0012-01 for a client
-- whose slug is TEST — nothing on the invoice named the client at all.
--
-- DECISION (John Haldemann, 2026-08-20): every invoice, proposal-linked or
-- not, gets SLUG-YYYY-INV-NN from the client's CURRENT slug. A client with no
-- slug yet still cannot be invoiced at all — the same refusal this function
-- already enforced on the standalone path, now applied uniformly instead of
-- on only one of the two.
--
-- client_invoices.proposal_id and client_proposals.invoice_seq are untouched:
-- the FK link, and every "raised from" query that reads it, are unaffected.
-- invoice_seq simply stops being read — left in place rather than dropped, an
-- unused column costs nothing and dropping it is not this migration's job.
--
-- ADDITIVE AND REVERSIBLE. One function replaced; the rollback restores
-- 20260819172603's body verbatim.
--
-- ROLLBACK:
--   create or replace function public.allocate_client_invoice_number()
--   returns trigger
--   language plpgsql
--   security definer
--   set search_path = pg_catalog, public
--   as $$
--   declare
--     v_parent text;
--     v_seq    integer;
--     v_year   integer;
--     v_slug   text;
--     v_name   text;
--   begin
--     if new.proposal_id is not null then
--       update public.client_proposals
--          set invoice_seq = invoice_seq + 1
--        where id = new.proposal_id
--          and proposal_number is not null
--       returning proposal_number, invoice_seq into v_parent, v_seq;
--
--       if v_parent is not null then
--         new.invoice_number := v_parent || '-'
--           || lpad(v_seq::text, greatest(2, length(v_seq::text)), '0');
--         return new;
--       end if;
--     end if;
--
--     v_year := extract(year from coalesce(new.issue_date, current_date))::integer;
--
--     select company_slug, name into v_slug, v_name
--       from public.company_clients
--      where id = new.client_id;
--
--     if v_slug is null then
--       raise exception
--         'cannot number a manual invoice for %: this company has no company slug yet',
--         coalesce(v_name, new.client_id::text)
--         using errcode = 'check_violation',
--               hint = 'Set the company slug on the client record first — it becomes the permanent prefix on this company''s documents, so a person has to choose it. Open the company, set the slug, then raise the invoice again.';
--     end if;
--
--     insert into public.client_invoice_year_counters (client_id, year, last_seq)
--     values (new.client_id, v_year, 1)
--     on conflict (client_id, year) do update
--       set last_seq = public.client_invoice_year_counters.last_seq + 1
--     returning last_seq into v_seq;
--
--     new.invoice_number := v_slug || '-' || v_year::text || '-INV-'
--       || lpad(v_seq::text, greatest(2, length(v_seq::text)), '0');
--     return new;
--   end $$;
--
--   revoke execute on function public.allocate_client_invoice_number() from public, anon, authenticated;

create or replace function public.allocate_client_invoice_number()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_seq  integer;
  v_year integer;
  v_slug text;
  v_name text;
begin
  v_year := extract(year from coalesce(new.issue_date, current_date))::integer;

  select company_slug, name into v_slug, v_name
    from public.company_clients
   where id = new.client_id;

  if v_slug is null then
    raise exception
      'cannot number an invoice for %: this company has no company slug yet',
      coalesce(v_name, new.client_id::text)
      using errcode = 'check_violation',
            hint = 'Set the company slug on the client record first — it becomes the permanent prefix on this company''s documents, so a person has to choose it. Open the company, set the slug, then raise the invoice again.';
  end if;

  insert into public.client_invoice_year_counters (client_id, year, last_seq)
  values (new.client_id, v_year, 1)
  on conflict (client_id, year) do update
    set last_seq = public.client_invoice_year_counters.last_seq + 1
  returning last_seq into v_seq;

  new.invoice_number := v_slug || '-' || v_year::text || '-INV-'
    || lpad(v_seq::text, greatest(2, length(v_seq::text)), '0');
  return new;
end $$;

revoke execute on function public.allocate_client_invoice_number() from public, anon, authenticated;

comment on function public.allocate_client_invoice_number() is
  'BEFORE INSERT on client_invoices: always SLUG-YYYY-INV-NN from the client''s own company_slug, whether or not the invoice is proposal-linked. Refuses (check_violation) when the client has no slug yet. Never honours a caller-supplied number.';
