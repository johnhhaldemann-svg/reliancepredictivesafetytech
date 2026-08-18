alter table public.company_clients
  add column if not exists stage_changed_at timestamptz;

comment on column public.company_clients.stage_changed_at is
  'When lifecycle_stage last changed. Set by the code paths that write lifecycle_stage, not by a trigger, so a bulk backfill of another column cannot reset every clock. Null on rows that predate the column — readers fall back to updated_at.';

create table if not exists public.client_stage_transitions (
  id               uuid primary key default gen_random_uuid(),
  client_id        uuid not null references public.company_clients(id) on delete cascade,
  from_stage       text,
  to_stage         text not null,
  was_override     boolean not null default false,
  override_reason  text check (override_reason is null or char_length(btrim(override_reason)) between 1 and 1000),
  blocked_reasons  jsonb not null default '[]'::jsonb,
  changed_by       uuid references auth.users(id) on delete set null,
  changed_at       timestamptz not null default now(),
  constraint client_stage_transitions_override_has_reason
    check (not was_override or override_reason is not null)
);

create index if not exists client_stage_transitions_client_idx
  on public.client_stage_transitions (client_id, changed_at desc);

create index if not exists client_stage_transitions_override_idx
  on public.client_stage_transitions (changed_at desc)
  where was_override;

alter table public.client_stage_transitions enable row level security;

drop policy if exists "Employees can read stage transitions" on public.client_stage_transitions;
create policy "Employees can read stage transitions"
  on public.client_stage_transitions for select to authenticated
  using (public.is_company_portal_employee());

drop policy if exists "Employees can record stage transitions" on public.client_stage_transitions;
create policy "Employees can record stage transitions"
  on public.client_stage_transitions for insert to authenticated
  with check (
    public.is_company_portal_employee()
    and changed_by = (select auth.uid())
  );

create table if not exists public.client_invoice_counters (
  year      integer primary key,
  last_seq  integer not null default 0
);

alter table public.client_invoice_counters enable row level security;

create table if not exists public.client_invoices (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid not null references public.company_clients(id) on delete cascade,
  proposal_id     uuid references public.client_proposals(id) on delete set null,
  invoice_number  text not null unique,
  status          text not null default 'draft'
                    check (status in ('draft', 'issued', 'paid', 'void')),
  kind            text not null default 'full'
                    check (kind in ('deposit', 'full', 'balance')),
  issue_date      date,
  due_date        date,
  currency        text not null default 'USD' check (char_length(currency) = 3),
  subtotal        numeric(14, 2) not null default 0 check (subtotal >= 0),
  total           numeric(14, 2) not null default 0 check (total >= 0),
  notes           text check (notes is null or char_length(notes) <= 4000),
  issued_at       timestamptz,
  issued_by       uuid references auth.users(id) on delete set null,
  paid_at         timestamptz,
  paid_by         uuid references auth.users(id) on delete set null,
  voided_at       timestamptz,
  void_reason     text check (void_reason is null or char_length(void_reason) <= 1000),
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint client_invoices_issued_has_date
    check (status <> 'issued' or (issued_at is not null and issue_date is not null)),
  constraint client_invoices_paid_has_date
    check (status <> 'paid' or paid_at is not null)
);

create index if not exists client_invoices_client_idx
  on public.client_invoices (client_id, created_at desc);

create index if not exists client_invoices_proposal_idx
  on public.client_invoices (proposal_id)
  where proposal_id is not null;

create index if not exists client_invoices_status_idx
  on public.client_invoices (status);

create unique index if not exists client_invoices_one_live_per_kind
  on public.client_invoices (proposal_id, kind)
  where proposal_id is not null and status <> 'void';

create table if not exists public.client_invoice_line_items (
  id           uuid primary key default gen_random_uuid(),
  invoice_id   uuid not null references public.client_invoices(id) on delete cascade,
  description  text not null check (char_length(btrim(description)) between 1 and 500),
  quantity     numeric(12, 2) not null default 1 check (quantity > 0),
  unit_amount  numeric(14, 2) not null default 0 check (unit_amount >= 0),
  line_total   numeric(14, 2) not null default 0 check (line_total >= 0),
  sort_order   integer not null default 100,
  created_at   timestamptz not null default now()
);

create index if not exists client_invoice_line_items_invoice_idx
  on public.client_invoice_line_items (invoice_id, sort_order);

create or replace function public.allocate_client_invoice_number()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_year integer;
  v_seq  integer;
begin
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
  'BEFORE INSERT on client_invoices: allocates RPS-INV-YYYY-NNNN from a per-year counter.';

drop trigger if exists allocate_client_invoice_number on public.client_invoices;
create trigger allocate_client_invoice_number
before insert on public.client_invoices
for each row execute function public.allocate_client_invoice_number();

drop trigger if exists set_client_invoices_updated_at on public.client_invoices;
create trigger set_client_invoices_updated_at
before update on public.client_invoices
for each row execute function public.set_updated_at();

alter table public.client_invoices enable row level security;
alter table public.client_invoice_line_items enable row level security;

drop policy if exists "Employees can read invoices" on public.client_invoices;
create policy "Employees can read invoices"
  on public.client_invoices for select to authenticated
  using (public.is_company_portal_employee());

drop policy if exists "Employees can create draft invoices" on public.client_invoices;
create policy "Employees can create draft invoices"
  on public.client_invoices for insert to authenticated
  with check (
    public.is_company_portal_employee()
    and status = 'draft'
    and issued_at is null
    and paid_at is null
    and created_by = (select auth.uid())
  );

drop policy if exists "Employees can update invoices" on public.client_invoices;
drop policy if exists "Admins can settle invoices" on public.client_invoices;
create policy "Admins can settle invoices"
  on public.client_invoices for update to authenticated
  using (public.is_company_portal_admin())
  with check (public.is_company_portal_admin());

drop policy if exists "Admins can delete invoices" on public.client_invoices;
create policy "Admins can delete invoices"
  on public.client_invoices for delete to authenticated
  using (
    public.is_company_portal_admin()
    or (status = 'draft' and created_by = (select auth.uid()) and public.is_company_portal_employee())
  );

drop policy if exists "Employees can read invoice lines" on public.client_invoice_line_items;
create policy "Employees can read invoice lines"
  on public.client_invoice_line_items for select to authenticated
  using (public.is_company_portal_employee());

drop policy if exists "Employees can create invoice lines" on public.client_invoice_line_items;
create policy "Employees can create invoice lines"
  on public.client_invoice_line_items for insert to authenticated
  with check (
    public.is_company_portal_employee()
    and exists (
      select 1 from public.client_invoices i
      where i.id = invoice_id and i.status = 'draft'
    )
  );

drop policy if exists "Employees can update invoice lines" on public.client_invoice_line_items;
create policy "Employees can update invoice lines"
  on public.client_invoice_line_items for update to authenticated
  using (
    public.is_company_portal_employee()
    and exists (
      select 1 from public.client_invoices i
      where i.id = invoice_id and i.status = 'draft'
    )
  )
  with check (
    public.is_company_portal_employee()
    and exists (
      select 1 from public.client_invoices i
      where i.id = invoice_id and i.status = 'draft'
    )
  );

drop policy if exists "Employees can delete invoice lines" on public.client_invoice_line_items;
create policy "Employees can delete invoice lines"
  on public.client_invoice_line_items for delete to authenticated
  using (
    public.is_company_portal_employee()
    and exists (
      select 1 from public.client_invoices i
      where i.id = invoice_id and i.status = 'draft'
    )
  );

alter table public.company_finance_transactions
  add column if not exists related_invoice_id uuid
    references public.client_invoices(id) on delete set null;

create index if not exists company_finance_transactions_related_invoice_idx
  on public.company_finance_transactions(related_invoice_id)
  where related_invoice_id is not null;