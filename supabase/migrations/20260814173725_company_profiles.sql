create table if not exists public.company_profiles (
  client_id              uuid primary key references public.company_clients(id) on delete cascade,

  employee_count         integer check (employee_count is null or employee_count between 0 and 500000),
  site_count             integer check (site_count is null or site_count between 0 and 5000),
  annual_revenue         numeric(16, 2) check (annual_revenue is null or annual_revenue >= 0),
  currency               text not null default 'USD' check (char_length(currency) = 3),

  primary_state          text check (primary_state is null or char_length(primary_state) <= 100),
  states_operated        text check (states_operated is null or char_length(states_operated) <= 500),

  naics_code             text check (naics_code is null or naics_code ~ '^[0-9]{2,6}$'),
  hazard_class           text check (hazard_class is null or hazard_class in ('low', 'moderate', 'high', 'severe')),

  emr                    numeric(4, 2) check (emr is null or emr between 0 and 10),
  trir                   numeric(5, 2) check (trir is null or trir between 0 and 200),

  recordables_12mo       integer check (recordables_12mo is null or recordables_12mo >= 0),
  lost_time_12mo         integer check (lost_time_12mo is null or lost_time_12mo >= 0),
  osha_citations_3yr     integer check (osha_citations_3yr is null or osha_citations_3yr >= 0),

  union_workforce        boolean,
  contractor_share_pct   integer check (contractor_share_pct is null or contractor_share_pct between 0 and 100),

  notes                  text check (notes is null or char_length(notes) <= 4000),
  verified_at            timestamptz,
  verified_by            uuid references auth.users(id) on delete set null,

  updated_by             uuid references auth.users(id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  constraint company_profiles_lost_time_within_recordables
    check (
      lost_time_12mo is null
      or recordables_12mo is null
      or lost_time_12mo <= recordables_12mo
    )
);

comment on table public.company_profiles is
  'Firmographics and safety loss record for one company. Feeds lib/pricing/contract-estimate.ts; revenue is a ceiling there, never a driver.';

comment on column public.company_profiles.emr is
  'Experience Modification Rate. 1.00 = industry average; higher means a worse loss history.';

drop trigger if exists set_company_profiles_updated_at on public.company_profiles;
create trigger set_company_profiles_updated_at
before update on public.company_profiles
for each row execute function public.set_updated_at();

alter table public.company_profiles enable row level security;

drop policy if exists "Employees can read company profiles" on public.company_profiles;
create policy "Employees can read company profiles"
  on public.company_profiles for select to authenticated
  using (public.is_company_portal_employee());

drop policy if exists "Employees can create company profiles" on public.company_profiles;
create policy "Employees can create company profiles"
  on public.company_profiles for insert to authenticated
  with check (
    public.is_company_portal_employee()
    and verified_at is null
    and verified_by is null
  );

drop policy if exists "Employees can update company profiles" on public.company_profiles;
create policy "Employees can update company profiles"
  on public.company_profiles for update to authenticated
  using (public.is_company_portal_employee())
  with check (
    public.is_company_portal_employee()
    and (verified_by is null or verified_by = (select auth.uid()))
  );

drop policy if exists "Admins can delete company profiles" on public.company_profiles;
create policy "Admins can delete company profiles"
  on public.company_profiles for delete to authenticated
  using (public.is_company_portal_admin());