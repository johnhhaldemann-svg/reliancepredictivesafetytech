alter table public.company_clients
  add column if not exists company_slug text;

alter table public.company_clients
  drop constraint if exists company_clients_company_slug_format;
alter table public.company_clients
  add constraint company_clients_company_slug_format
  check (
    company_slug is null
    or (company_slug ~ '^[A-Z0-9]{2,40}$' and company_slug <> 'RPS')
  );

create unique index if not exists company_clients_company_slug_key
  on public.company_clients (company_slug)
  where company_slug is not null;

comment on column public.company_clients.company_slug is
  'Full company name, uppercase, no spaces or punctuation, 2-40 chars (WONDFOUSA). Prefixes every proposal number. Supersedes client_code, which is retained so legacy numbers stay explicable.';

create table if not exists public.client_proposal_year_counters (
  client_id uuid not null references public.company_clients(id) on delete cascade,
  year      integer not null,
  last_seq  integer not null default 0,
  primary key (client_id, year)
);

alter table public.client_proposal_year_counters enable row level security;

comment on table public.client_proposal_year_counters is
  'Last proposal sequence allocated per client per calendar year. Written only by allocate_client_proposal_number(); no RLS policy by design.';

create or replace function public.company_slug_locked(p_client uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.client_proposal_year_counters c
     where c.client_id = p_client
  );
$$;

revoke execute on function public.company_slug_locked(uuid) from public, anon;
grant execute on function public.company_slug_locked(uuid) to authenticated;

comment on function public.company_slug_locked(uuid) is
  'True once any proposal number has been allocated for this client, i.e. once company_slug can no longer be changed. Reads the counter table the app is otherwise denied.';

create or replace function public.lock_company_slug()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if old.company_slug is null then
    return new;
  end if;
  if new.company_slug is distinct from old.company_slug
     and public.company_slug_locked(old.id) then
    raise exception
      'company_slug is locked once the client has been issued a proposal number (% is in use)', old.company_slug
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists lock_company_slug on public.company_clients;
create trigger lock_company_slug
before update on public.company_clients
for each row execute function public.lock_company_slug();

comment on function public.lock_company_slug() is
  'Refuses a company_slug change once any proposal number has been allocated for that client. Prevents orphaning issued numbers.';

alter table public.client_proposals
  add column if not exists invoice_seq integer not null default 0,
  add column if not exists legacy_proposal_number text;

comment on column public.client_proposals.invoice_seq is
  'Last invoice sequence allocated against this proposal. Bumped atomically by allocate_client_invoice_number(); never edited by hand.';
comment on column public.client_proposals.legacy_proposal_number is
  'The number this proposal carried before being renumbered onto the company-slug scheme. Drafts only — an issued document is never renumbered.';

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
  insert into public.client_invoice_counters (year, last_seq)
  values (v_year, 1)
  on conflict (year) do update
    set last_seq = public.client_invoice_counters.last_seq + 1
  returning last_seq into v_seq;

  new.invoice_number := 'RPS-INV-' || v_year::text || '-'
    || lpad(v_seq::text, greatest(4, length(v_seq::text)), '0');
  return new;
end $$;

revoke execute on function public.allocate_client_invoice_number() from public, anon, authenticated;

comment on function public.allocate_client_invoice_number() is
  'BEFORE INSERT on client_invoices: PROPOSAL-NN against a numbered parent, global RPS-INV fallback otherwise. Never honours a caller-supplied number.';

drop index if exists public.client_invoices_one_live_per_kind;

alter table public.client_invoices alter column kind drop not null;
alter table public.client_invoices alter column kind drop default;

comment on column public.client_invoices.kind is
  'RETIRED 2026-08-14. Historical deposit/full/balance carve. New invoices sequence off the parent proposal instead; retained so existing rows stay explicable.';

create or replace function public.guard_client_invoice_total()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_value   numeric(14, 2);
  v_live    numeric(14, 2);
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

  if v_live > v_value then
    raise exception
      'invoices against this proposal would total %, above its contract value of %',
      v_live, v_value
      using errcode = 'check_violation',
            hint = 'Void or reprice an existing invoice, or raise the proposal value.';
  end if;

  return new;
end $$;

revoke execute on function public.guard_client_invoice_total() from public, anon, authenticated;

drop trigger if exists guard_client_invoice_total on public.client_invoices;
create trigger guard_client_invoice_total
after insert or update of total, status, proposal_id on public.client_invoices
for each row execute function public.guard_client_invoice_total();

comment on function public.guard_client_invoice_total() is
  'Refuses an invoice that would take the live invoiced total above the parent proposal value. Replaces client_invoices_one_live_per_kind, which capped the count instead of the money.';

create or replace function public.guard_client_proposal_billing_fields()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_live numeric(14, 2);
begin
  if new.proposal_number is distinct from old.proposal_number
     and old.status is distinct from 'draft' then
    raise exception
      'proposal % is %, and an issued document''s number cannot change', old.proposal_number, old.status
      using errcode = 'check_violation',
            hint = 'Only drafts are renumbered. The client holds this number on the document they were sent.';
  end if;

  if new.invoice_seq < old.invoice_seq then
    raise exception 'invoice_seq only moves forward (% -> %)', old.invoice_seq, new.invoice_seq
      using errcode = 'check_violation',
            hint = 'Lowering it would re-mint invoice numbers that already exist.';
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

revoke execute on function public.guard_client_proposal_billing_fields() from public, anon, authenticated;

drop trigger if exists guard_client_proposal_billing_fields on public.client_proposals;
create trigger guard_client_proposal_billing_fields
before update on public.client_proposals
for each row execute function public.guard_client_proposal_billing_fields();

comment on function public.guard_client_proposal_billing_fields() is
  'Keeps proposal_value from dropping below what is already invoiced, pins the number of a non-draft proposal, and keeps invoice_seq monotonic. The other half of guard_client_invoice_total().';

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