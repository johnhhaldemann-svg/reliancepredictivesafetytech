-- Corrective fix: applying PR #4's 20260815120000_client_document_numbering.sql
-- to production overwrote allocate_client_proposal_number(),
-- allocate_client_invoice_number() and renumber_client_draft_proposals() with
-- the OLD client_code-based scheme. That scheme was formally abandoned by
-- decision of record (John Haldemann / Steven Sladky, 2026-08-14) in favor of
-- the company_slug scheme shipped by 20260815140000_company_slug_document_numbering.sql
-- and extended by 20260818210000_manual_invoice_numbering.sql, both already
-- live in production before PR #4's migration was mistakenly applied on top.
-- This restores those two migrations' function bodies verbatim, character for
-- character, undoing the regression. PR #4 itself is not being merged.
--
-- RECOVERED FROM PRODUCTION. This file did not exist in the repository —
-- someone applied it directly against the live database (it is present in
-- supabase_migrations.schema_migrations there) without ever committing the
-- file. Re-created here verbatim from supabase_migrations.schema_migrations.statements
-- so the migration history in git matches what is actually live, per the
-- divergence this project has hit before (see also
-- 20260819134239_client_document_numbering.sql, the still-uncorrected PR #4
-- file this migration overrides — left in place rather than deleted, since it
-- has also already been applied to production; removing it needs its own
-- sign-off, not a silent rewrite of migration history).

create or replace function public.allocate_client_proposal_number()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_slug text;
  v_code text;
  v_year integer;
  v_seq  integer;
begin
  v_year := extract(year from coalesce(new.created_at, now()))::integer;

  if new.client_id is not null then
    select company_slug, client_code into v_slug, v_code
      from public.company_clients
     where id = new.client_id;

    if v_slug is not null then
      insert into public.client_proposal_year_counters (client_id, year, last_seq)
      values (new.client_id, v_year, 1)
      on conflict (client_id, year) do update
        set last_seq = public.client_proposal_year_counters.last_seq + 1
      returning last_seq into v_seq;

      new.proposal_number := v_slug || '-' || v_year::text || '-'
        || lpad(v_seq::text, greatest(3, length(v_seq::text)), '0');
      return new;
    end if;

    if v_code is not null then
      update public.company_clients
         set proposal_seq = proposal_seq + 1
       where id = new.client_id
      returning proposal_seq into v_seq;

      if v_seq is not null then
        new.proposal_number := v_code || '-'
          || lpad(v_seq::text, greatest(2, length(v_seq::text)), '0');
        return new;
      end if;
    end if;
  end if;

  new.proposal_number := public.next_client_proposal_number();
  return new;
end $$;

revoke execute on function public.allocate_client_proposal_number() from public, anon, authenticated;

comment on function public.allocate_client_proposal_number() is
  'BEFORE INSERT on client_proposals: SLUG-YYYY-NNN for slugged clients, global RPS fallback otherwise. Never honours a caller-supplied number.';

create or replace function public.allocate_client_invoice_number()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_parent text;
  v_seq    integer;
  v_year   integer;
  v_slug   text;
  v_name   text;
begin
  if new.proposal_id is not null then
    update public.client_proposals
       set invoice_seq = invoice_seq + 1
     where id = new.proposal_id
       and proposal_number is not null
    returning proposal_number, invoice_seq into v_parent, v_seq;

    if v_parent is not null then
      new.invoice_number := v_parent || '-'
        || lpad(v_seq::text, greatest(2, length(v_seq::text)), '0');
      return new;
    end if;
  end if;

  v_year := extract(year from coalesce(new.issue_date, current_date))::integer;

  select company_slug, name into v_slug, v_name
    from public.company_clients
   where id = new.client_id;

  if v_slug is null then
    raise exception
      'cannot number a manual invoice for %: this company has no company slug yet',
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
  'BEFORE INSERT on client_invoices, three branches: PROPOSAL-NN against a numbered parent; SLUG-YYYY-INV-NN off client_invoice_year_counters for a manual invoice for a slugged client; and a check_violation for a manual invoice for a client with no company_slug, which is refused rather than numbered under the retired global RPS-INV scheme. Never honours a caller-supplied number.';

create or replace function public.renumber_client_draft_proposals(p_client uuid)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_slug   text;
  v_year   integer;
  v_seq    integer;
  v_number text;
  v_count  integer := 0;
  r        record;
begin
  if not public.is_company_portal_employee() then
    raise exception 'not authorised to renumber proposals'
      using errcode = 'insufficient_privilege';
  end if;

  select company_slug into v_slug
    from public.company_clients
   where id = p_client;

  if v_slug is null then
    return 0;
  end if;

  for r in
    select p.id, p.proposal_number, p.created_at
      from public.client_proposals p
     where p.client_id = p_client
       and p.status = 'draft'
       and (p.proposal_number is null or p.proposal_number not like v_slug || '-%')
     order by p.created_at nulls last, p.id
  loop
    v_year := extract(year from coalesce(r.created_at, now()))::integer;

    insert into public.client_proposal_year_counters (client_id, year, last_seq)
    values (p_client, v_year, 1)
    on conflict (client_id, year) do update
      set last_seq = public.client_proposal_year_counters.last_seq + 1
    returning last_seq into v_seq;

    v_number := v_slug || '-' || v_year::text || '-'
      || lpad(v_seq::text, greatest(3, length(v_seq::text)), '0');

    update public.client_proposals
       set proposal_number = v_number,
           legacy_proposal_number = coalesce(legacy_proposal_number, r.proposal_number),
           form_data = case
             when jsonb_typeof(form_data -> 'fields') = 'object'
               then jsonb_set(form_data, '{fields,proposalNo}', to_jsonb(v_number), true)
             else form_data
           end
     where id = r.id
       and status = 'draft';

    v_count := v_count + 1;
  end loop;

  return v_count;
end $$;

revoke execute on function public.renumber_client_draft_proposals(uuid) from public, anon;
grant execute on function public.renumber_client_draft_proposals(uuid) to authenticated;

comment on function public.renumber_client_draft_proposals(uuid) is
  'Moves a client''s DRAFT proposals onto SLUG-YYYY-NNN in creation order, keeping the previous number in legacy_proposal_number and mirroring the new one into form_data. Never touches a sent, accepted, declined or archived proposal. SECURITY DEFINER with an explicit is_company_portal_employee() check.';
