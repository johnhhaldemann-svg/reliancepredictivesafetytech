create table if not exists public.opportunity_qualification (
  opportunity_id        uuid primary key references public.opportunities(id) on delete cascade,

  discovery_call_at     timestamptz,
  primary_need          text check (primary_need is null or char_length(primary_need) <= 2000),
  pain_points           text check (pain_points is null or char_length(pain_points) <= 4000),
  decision_makers       text check (decision_makers is null or char_length(decision_makers) <= 2000),
  budget_range          text check (budget_range is null or char_length(budget_range) <= 200),
  timeline              text check (timeline is null or char_length(timeline) <= 200),

  has_budget            boolean not null default false,
  has_authority         boolean not null default false,
  has_need              boolean not null default false,
  has_timeline          boolean not null default false,

  competition           text check (competition is null or char_length(competition) <= 1000),

  qualified_at          timestamptz,
  qualified_by          uuid references auth.users(id) on delete set null,

  updated_by            uuid references auth.users(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint opportunity_qualification_qualified_has_actor
    check (qualified_at is null or qualified_by is not null)
);

create index if not exists opportunity_qualification_qualified_idx
  on public.opportunity_qualification (qualified_at desc)
  where qualified_at is not null;

drop trigger if exists set_opportunity_qualification_updated_at on public.opportunity_qualification;
create trigger set_opportunity_qualification_updated_at
before update on public.opportunity_qualification
for each row execute function public.set_updated_at();

alter table public.opportunity_qualification enable row level security;

drop policy if exists "Employees can read qualification" on public.opportunity_qualification;
create policy "Employees can read qualification"
  on public.opportunity_qualification for select to authenticated
  using (public.is_company_portal_employee());

drop policy if exists "Employees can write qualification" on public.opportunity_qualification;
create policy "Employees can write qualification"
  on public.opportunity_qualification for insert to authenticated
  with check (
    public.is_company_portal_employee()
    and exists (
      select 1 from public.opportunities o
      where o.id = opportunity_id and o.status = 'open'
    )
  );

drop policy if exists "Employees can update qualification" on public.opportunity_qualification;
create policy "Employees can update qualification"
  on public.opportunity_qualification for update to authenticated
  using (
    public.is_company_portal_employee()
    and exists (
      select 1 from public.opportunities o
      where o.id = opportunity_id and o.status = 'open'
    )
  )
  with check (public.is_company_portal_employee());

drop policy if exists "Admins can delete qualification" on public.opportunity_qualification;
create policy "Admins can delete qualification"
  on public.opportunity_qualification for delete to authenticated
  using (public.is_company_portal_admin());