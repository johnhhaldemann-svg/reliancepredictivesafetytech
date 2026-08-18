create table if not exists public.company_grant_opportunities (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null check (char_length(btrim(name)) between 1 and 200),
  agency               text check (agency is null or char_length(agency) <= 200),
  sub_agency           text check (sub_agency is null or char_length(sub_agency) <= 200),
  contact              text check (contact is null or char_length(contact) <= 200),
  status               text not null default 'identified'
                         check (status in (
                           'identified', 'researching', 'inquiry_sent', 'pre_registered',
                           'application_submitted', 'on_hold',
                           'awarded', 'declined', 'not_eligible'
                         )),
  status_changed_at    timestamptz not null default now(),
  requirements         text check (requirements is null or char_length(requirements) <= 4000),
  fee_amount           numeric(10, 2) check (fee_amount is null or fee_amount >= 0),
  fee_kind             text check (fee_kind is null or fee_kind in ('application', 'membership', 'other')),
  fee_paid             boolean not null default false,
  award_amount         numeric(12, 2) check (award_amount is null or award_amount >= 0),
  website_url          text check (website_url is null or website_url ~ '^https?://'),
  website_label        text check (website_label is null or char_length(website_label) <= 300),
  opens_on             date,
  deadline             date,
  submitted_at         timestamptz,
  owner_user_id        uuid references auth.users(id) on delete set null,
  next_action          text check (next_action is null or char_length(next_action) <= 500),
  next_action_due      date,
  notes                text check (notes is null or char_length(notes) <= 8000),
  outcome_reason       text check (outcome_reason is null or char_length(outcome_reason) <= 1000),
  decided_at           timestamptz,
  created_by           uuid references auth.users(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint company_grant_opportunities_outcome_has_reason
    check (
      status not in ('awarded', 'declined', 'not_eligible')
      or outcome_reason is not null
    ),
  constraint company_grant_opportunities_fee_paid_needs_amount
    check (fee_paid = false or fee_amount is not null),
  constraint company_grant_opportunities_fee_kind_needs_amount
    check (fee_kind is null or fee_amount is not null),
  constraint company_grant_opportunities_window_ordered
    check (opens_on is null or deadline is null or opens_on <= deadline)
);

comment on table public.company_grant_opportunities is
  'Grant and funding programmes the company is pursuing. Ported from the Grant Tracker sheet; status keys are defined in lib/grants/statuses.ts.';

comment on column public.company_grant_opportunities.sub_agency is
  'Distinguishes programmes run by many agencies - the two SBIR rows (NOAA, NIST) are separate applications, and the uniqueness index depends on this.';

comment on column public.company_grant_opportunities.website_label is
  'Display text for a source cell that is not a URL, or a URL too truncated to link. website_url holds only links that actually resolve.';

create unique index if not exists company_grant_opportunities_name_agency_key
  on public.company_grant_opportunities (
    lower(btrim(name)),
    lower(coalesce(btrim(sub_agency), ''))
  );

create index if not exists company_grant_opportunities_status_idx
  on public.company_grant_opportunities (status, status_changed_at desc);

create index if not exists company_grant_opportunities_deadline_idx
  on public.company_grant_opportunities (deadline)
  where deadline is not null
    and status not in ('awarded', 'declined', 'not_eligible');

create index if not exists company_grant_opportunities_owner_idx
  on public.company_grant_opportunities (owner_user_id)
  where owner_user_id is not null;

drop trigger if exists set_company_grant_opportunities_updated_at
  on public.company_grant_opportunities;
create trigger set_company_grant_opportunities_updated_at
before update on public.company_grant_opportunities
for each row execute function public.set_updated_at();

create or replace function public.set_grant_status_changed_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.status is distinct from old.status then
    new.status_changed_at := now();

    if new.status in ('awarded', 'declined', 'not_eligible') then
      new.decided_at := coalesce(new.decided_at, now());
    else
      new.decided_at := null;
    end if;

    if new.status = 'application_submitted' then
      new.submitted_at := coalesce(new.submitted_at, now());
    end if;
  end if;

  return new;
end $$;

drop trigger if exists set_grant_status_changed_at on public.company_grant_opportunities;
create trigger set_grant_status_changed_at
before update on public.company_grant_opportunities
for each row execute function public.set_grant_status_changed_at();

alter table public.company_grant_opportunities enable row level security;

grant select, insert, update, delete on public.company_grant_opportunities to authenticated;

drop policy if exists "Employees can read grant opportunities"
  on public.company_grant_opportunities;
create policy "Employees can read grant opportunities"
  on public.company_grant_opportunities for select to authenticated
  using (public.is_company_portal_employee());

drop policy if exists "Employees can create grant opportunities"
  on public.company_grant_opportunities;
create policy "Employees can create grant opportunities"
  on public.company_grant_opportunities for insert to authenticated
  with check (
    public.is_company_portal_employee()
    and status not in ('awarded', 'declined', 'not_eligible')
    and outcome_reason is null
    and decided_at is null
    and created_by = (select auth.uid())
  );

drop policy if exists "Employees can update live grant opportunities"
  on public.company_grant_opportunities;
create policy "Employees can update live grant opportunities"
  on public.company_grant_opportunities for update to authenticated
  using (
    public.is_company_portal_employee()
    and status not in ('awarded', 'declined', 'not_eligible')
  )
  with check (public.is_company_portal_employee());

drop policy if exists "Admins can update any grant opportunity"
  on public.company_grant_opportunities;
create policy "Admins can update any grant opportunity"
  on public.company_grant_opportunities for update to authenticated
  using (public.is_company_portal_admin())
  with check (public.is_company_portal_admin());

drop policy if exists "Admins can delete grant opportunities"
  on public.company_grant_opportunities;
create policy "Admins can delete grant opportunities"
  on public.company_grant_opportunities for delete to authenticated
  using (public.is_company_portal_admin());

alter table public.portal_user_module_access
  drop constraint if exists portal_user_module_access_module_key_check;

alter table public.portal_user_module_access
  add constraint portal_user_module_access_module_key_check
  check (
    module_key in (
      'dashboard', 'mobile_app', 'ai_command', 'website_operations', 'work_management',
      'parking_lots', 'employee_expenses', 'reports', 'finance', 'payroll_tracker',
      'grant_tracker', 'operations_database', 'startup_checklist', 'demo_showcase',
      'request_inbox', 'sales_pipeline', 'client_lifecycle', 'client_proposals',
      'ehs_talent_engine', 'active_companies', 'employee_mail', 'company_tree',
      'hr_onboarding', 'training', 'performance_reviews', 'hr_documents', 'time_cards',
      'employee_time_off', 'employee_calendar', 'master_document_library', 'file_center',
      'ai_document_builder', 'legal_issues', 'legal_register', 'required_documents',
      'launch_gate', 'users', 'settings', 'platform_sprint', 'platform_releases',
      'platform_qa', 'platform_metrics', 'platform_docs', 'platform_packages',
      'platform_billing', 'platform_audit', 'platform_ai_services',
      'platform_infrastructure', 'platform_dev_command'
    )
  );

with seed_grants(
  name, agency, sub_agency, contact, status, requirements,
  fee_amount, fee_kind, fee_paid, award_amount,
  website_url, website_label, opens_on, notes, outcome_reason
) as (
  values
    ('F1st CP', null, null, 'info@f1stcp.com', 'application_submitted',
     'Applied',
     null::numeric, null, false, null::numeric,
     null, 'Small Certified Supplier Innovative Finance Program', null::date,
     'Programme name was cut off in the source sheet - confirm the exact legal name and add the agency.',
     null),

    ('Freed Fellowship Grant', null, null, null, 'researching',
     '$500 grant $19 app fee potential to recieve business advice and $2500 at year end',
     19.00, 'application', false, 500.00,
     null, '$500 Freed Fellowship Grant', null,
     'Year-end follow-on of $2,500 is not modelled as a separate row; it is the same programme.',
     null),

    ('Lighter Capital', null, null, null, 'on_hold',
     'future objective this is capital investment not grants',
     null, null, false, null,
     null, 'https://www.lightercapital.com/guides/raising-ca...', null,
     'Revenue-based financing, not a grant. Kept in the tracker as a funding route. Source URL truncated - confirm before linking.',
     null),

    ('NASE Growth Grant', 'National Association for the Self-Employed', null, '1-800-649-6273', 'researching',
     'This also requires a $125 membership to NASE to apply along with: Statement of Grant use, P&L statement, Business Plan, Photo of Member, any additional supporting documents we could provide',
     125.00, 'membership', false, null,
     null, 'https://www.nase.org/become-a-member/mem...', null,
     'The $125 is a membership gate, not a filing fee - fee_kind reflects that. Source URL truncated.',
     null),

    ('Outta Excuses', null, null, 'grant@outtaexcuses.com', 'application_submitted',
     '$15 application fee. Paid.',
     15.00, 'application', true, null,
     null, null, null, null, null),

    ('SBIR', null, 'NOAA', 'noaa.sbir@noaa.gov', 'inquiry_sent',
     'response/more research',
     null, null, false, null,
     null, null, null,
     'One of two SBIR rows; NOAA and NIST are separate applications under the same programme.',
     null),

    ('SBIR', null, 'NIST', 'sbir@nist.gov', 'inquiry_sent',
     'response/more research',
     null, null, false, null,
     null, null, null,
     'One of two SBIR rows; NOAA and NIST are separate applications under the same programme.',
     null),

    ('SecretSOS', null, null, null, 'application_submitted',
     '$15 application fee. Paid.',
     15.00, 'application', true, null,
     'https://secretsos.com/', null, null, null, null),

    ('Stephen L. Tadlock for Veterans (National Grant)', null, null, null, 'pre_registered',
     'Applications open September 15th 2026, pre-reg completed',
     null, null, false, null,
     null, null, '2026-09-15'::date,
     'Pre-registration complete. Move to application_submitted once the window opens.',
     null),

    ('$20,000 Veteran Founder grant', null, null, null, 'identified',
     '$20k opportunity more review to look into',
     null, null, false, 20000.00,
     null, 'linkedin.com/pulse/20000-veteran-...', null,
     'Sourced from a LinkedIn article; the source URL is truncated and has no scheme. Confirm the sponsoring organisation.',
     null),

    ('Warrior Rising - Business Showers', 'Warrior Rising', null, null, 'researching',
     'Requires attendence and graduation of warrior university which then requires highly competitive application',
     null, null, false, null,
     null, null, null,
     'Two gates: Warrior University graduation, then a competitive application.',
     null),

    ('Zensurance Grant', 'Zensurance', null, null, 'not_eligible',
     'Our product must help generate revenue for Canadian Businesses. at the current time we don''t to my knowledge will ask Steve and John regarding this',
     null, null, false, null,
     null, null, null,
     'Re-open if the product line changes to serve Canadian businesses.',
     'Programme requires the product to generate revenue for Canadian businesses; we do not at present. Confirm with Steve and John before closing permanently.')
)
insert into public.company_grant_opportunities (
  name, agency, sub_agency, contact, status, requirements,
  fee_amount, fee_kind, fee_paid, award_amount,
  website_url, website_label, opens_on, notes, outcome_reason,
  decided_at, submitted_at, created_by
)
select
  name, agency, sub_agency, contact, status, requirements,
  fee_amount, fee_kind, fee_paid, award_amount,
  website_url, website_label, opens_on, notes, outcome_reason,
  case when status in ('awarded', 'declined', 'not_eligible') then now() end,
  case when status = 'application_submitted' then now() end,
  null
from seed_grants
on conflict (lower(btrim(name)), lower(coalesce(btrim(sub_agency), ''))) do nothing;