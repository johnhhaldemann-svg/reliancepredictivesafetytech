create table if not exists public.opportunities (
  id                   uuid primary key default gen_random_uuid(),
  client_id            uuid references public.company_clients(id) on delete set null,
  demo_request_id      uuid references public.demo_requests(id) on delete set null,

  name                 text not null check (char_length(btrim(name)) between 1 and 200),

  step                 text not null default 'lead_captured'
                         check (step in (
                           'lead_captured', 'ai_triage', 'sales_review', 'assign_owner',
                           'discovery', 'opportunity_qualified', 'solution_proposal',
                           'proposal_review', 'negotiation_approval', 'commit_contract',
                           'closed_won_onboarded'
                         )),

  status               text not null default 'open'
                         check (status in ('open', 'won', 'closed_lost', 'on_hold', 'disqualified')),

  step_changed_at      timestamptz not null default now(),

  owner_user_id        uuid references auth.users(id) on delete set null,
  assigned_at          timestamptz,

  value                numeric(14, 2) not null default 0 check (value >= 0),
  currency             text not null default 'USD' check (char_length(currency) = 3),
  probability          integer not null default 0 check (probability between 0 and 100),
  expected_close_date  date,

  ai_score             integer check (ai_score is null or ai_score between 0 and 100),
  ai_confidence        text check (ai_confidence is null or ai_confidence in ('low', 'medium', 'high')),
  ai_scored_at         timestamptz,
  ai_recommendation    text check (ai_recommendation is null or char_length(ai_recommendation) <= 2000),

  source               text,
  industry             text,
  region               text,
  product_interest     text,

  next_action          text check (next_action is null or char_length(next_action) <= 500),
  next_action_due      date,
  last_contact_at      timestamptz,

  notes                text check (notes is null or char_length(notes) <= 8000),

  exit_reason          text check (exit_reason is null or char_length(exit_reason) <= 1000),
  exit_competitor      text check (exit_competitor is null or char_length(exit_competitor) <= 200),
  exited_at            timestamptz,
  exited_by            uuid references auth.users(id) on delete set null,
  hold_until           date,

  created_by           uuid references auth.users(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  constraint opportunities_exit_has_reason
    check (status in ('open', 'won') or exit_reason is not null),
  constraint opportunities_exit_has_moment
    check (status in ('open', 'won') or exited_at is not null)
);

create index if not exists opportunities_step_idx
  on public.opportunities (step, step_changed_at desc)
  where status = 'open';

create index if not exists opportunities_owner_idx
  on public.opportunities (owner_user_id, step)
  where status = 'open';

create index if not exists opportunities_client_idx
  on public.opportunities (client_id, created_at desc)
  where client_id is not null;

create index if not exists opportunities_demo_request_idx
  on public.opportunities (demo_request_id)
  where demo_request_id is not null;

create index if not exists opportunities_close_date_idx
  on public.opportunities (expected_close_date)
  where status = 'open';

drop trigger if exists set_opportunities_updated_at on public.opportunities;
create trigger set_opportunities_updated_at
before update on public.opportunities
for each row execute function public.set_updated_at();

create or replace function public.set_opportunity_step_changed_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.step is distinct from old.step then
    new.step_changed_at := now();
  end if;
  return new;
end $$;

drop trigger if exists set_opportunity_step_changed_at on public.opportunities;
create trigger set_opportunity_step_changed_at
before update on public.opportunities
for each row execute function public.set_opportunity_step_changed_at();

create table if not exists public.opportunity_stage_events (
  id               uuid primary key default gen_random_uuid(),
  opportunity_id   uuid not null references public.opportunities(id) on delete cascade,

  from_step        text,
  to_step          text not null,
  from_status      text,
  to_status        text not null,

  kind             text not null
                     check (kind in ('advance', 'skip', 'back', 'exit', 'reopen')),

  reason           text check (reason is null or char_length(btrim(reason)) between 1 and 1000),
  steps_skipped    integer not null default 0 check (steps_skipped >= 0),

  changed_by       uuid references auth.users(id) on delete set null,
  changed_at       timestamptz not null default now(),

  constraint opportunity_stage_events_reason_required
    check (kind = 'advance' or reason is not null)
);

create index if not exists opportunity_stage_events_opportunity_idx
  on public.opportunity_stage_events (opportunity_id, changed_at desc);

create index if not exists opportunity_stage_events_exception_idx
  on public.opportunity_stage_events (changed_at desc)
  where kind in ('skip', 'back', 'exit');

alter table public.opportunities enable row level security;
alter table public.opportunity_stage_events enable row level security;

drop policy if exists "Employees can read opportunities" on public.opportunities;
create policy "Employees can read opportunities"
  on public.opportunities for select to authenticated
  using (public.is_company_portal_employee());

drop policy if exists "Employees can create opportunities" on public.opportunities;
create policy "Employees can create opportunities"
  on public.opportunities for insert to authenticated
  with check (
    public.is_company_portal_employee()
    and step = 'lead_captured'
    and status = 'open'
    and exited_at is null
    and created_by = (select auth.uid())
  );

drop policy if exists "Employees can update open opportunities" on public.opportunities;
create policy "Employees can update open opportunities"
  on public.opportunities for update to authenticated
  using (public.is_company_portal_employee() and status = 'open')
  with check (public.is_company_portal_employee());

drop policy if exists "Admins can update any opportunity" on public.opportunities;
create policy "Admins can update any opportunity"
  on public.opportunities for update to authenticated
  using (public.is_company_portal_admin())
  with check (public.is_company_portal_admin());

drop policy if exists "Admins can delete opportunities" on public.opportunities;
create policy "Admins can delete opportunities"
  on public.opportunities for delete to authenticated
  using (public.is_company_portal_admin());

drop policy if exists "Employees can read stage events" on public.opportunity_stage_events;
create policy "Employees can read stage events"
  on public.opportunity_stage_events for select to authenticated
  using (public.is_company_portal_employee());

drop policy if exists "Employees can record stage events" on public.opportunity_stage_events;
create policy "Employees can record stage events"
  on public.opportunity_stage_events for insert to authenticated
  with check (
    public.is_company_portal_employee()
    and changed_by = (select auth.uid())
  );