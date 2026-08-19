create table if not exists public.client_invoice_year_counters (
  client_id uuid not null references public.company_clients(id) on delete cascade,
  year      integer not null,
  last_seq  integer not null default 0,
  primary key (client_id, year)
);

alter table public.client_invoice_year_counters enable row level security;

comment on table public.client_invoice_year_counters is
  'Last manual-invoice sequence allocated per client per calendar year. Written only by allocate_client_invoice_number(); no RLS policy by design.';

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
  ) or exists (
    select 1 from public.client_invoice_year_counters c
     where c.client_id = p_client
  );
$$;

revoke execute on function public.company_slug_locked(uuid) from public, anon;
grant execute on function public.company_slug_locked(uuid) to authenticated;

comment on function public.company_slug_locked(uuid) is
  'True once any proposal OR manual-invoice number has been allocated for this client, i.e. once company_slug can no longer be changed without orphaning a number a client already holds. Reads the two counter tables the application is otherwise denied.';
