alter table public.client_proposals
  add column if not exists opportunity_id uuid
    references public.opportunities(id) on delete set null;

comment on column public.client_proposals.opportunity_id is
  'The deal this proposal prices. Null for proposals that predate the lifecycle, or that were never linked — client_id remains the company link in both cases.';

create index if not exists client_proposals_opportunity_idx
  on public.client_proposals (opportunity_id, created_at desc)
  where opportunity_id is not null;