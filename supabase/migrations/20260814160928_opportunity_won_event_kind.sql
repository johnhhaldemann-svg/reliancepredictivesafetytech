alter table public.opportunity_stage_events
  drop constraint if exists opportunity_stage_events_kind_check;

alter table public.opportunity_stage_events
  add constraint opportunity_stage_events_kind_check
  check (kind in ('advance', 'skip', 'back', 'exit', 'reopen', 'won'));

alter table public.opportunity_stage_events
  drop constraint if exists opportunity_stage_events_reason_required;

alter table public.opportunity_stage_events
  add constraint opportunity_stage_events_reason_required
  check (kind in ('advance', 'won') or reason is not null);

comment on column public.opportunity_stage_events.kind is
  'advance — the ordinary Next Step · skip — jumped one or more steps · back — moved backwards to correct a mistake · exit — Closed Lost / On Hold / Disqualified · reopen — brought back from an exit · won — closed won at step 11.';