-- One identifier for a client's documents, and an invoice number that names its
-- parent proposal.
--
-- MODULE_ID: client_proposals, client_invoices
--
-- WHY. Two decisions of record contradicted each other and each had been half
-- implemented:
--
--   * 2026-08-14 — company_slug (WONDFOUSA) supersedes client_code. Implemented
--     in the DATABASE only. The application has never had a single reference to
--     company_slug: it cannot read one, cannot set one, and every slug in
--     production was typed straight into the table by hand.
--   * 2026-08-19 build review — the identifier is client_code, and it moved from
--     a shouted abbreviation (WFU) to the moniker people actually use (Wondfo).
--     Implemented in the APPLICATION only: UI, validation, suggestClientCode(),
--     assignClientCode(), audit. The database ignores it whenever a slug exists.
--
-- The result was a client whose documents disagreed about what to call them.
-- Proposal RPS-2026-0011 printed "WFO-2026-002" on the client's copy, sat in the
-- ledger as RPS-2026-0011, and raised an invoice numbered WONDFOUSA-2026-INV-07.
-- Worse, assignClientCode() calls renumber_client_draft_proposals(), which keys
-- off the slug — so assigning a code renumbered nothing at all.
--
-- DECISION (John Haldemann, 2026-09-01): client_code wins. The evidence is what
-- the humans type — Steve hand-wrote "Wondfo-2026-001" into the generator, not
-- WONDFOUSA and not WFU. It is also the only one of the two with a UI behind it;
-- choosing the slug would have meant building that UI from scratch in order to
-- land on the uglier string. company_slug is kept as a fallback so numbers
-- already minted under it stay explicable, and is no longer written by anything.
--
-- DECISION (Steve Sladky / Custin, 2026-08-31): an invoice hangs off its parent
-- proposal — Wondfo-2026-002 raises Wondfo-2026-002-01, -02, -03. The sequence
-- restarts at 01 per proposal by construction, which is what the "why does this
-- invoice say 07 when there are no invoices" complaint was really asking for.
--
-- This REVERSES 20260820150000, which cut invoice numbers loose from proposals.
-- That migration's reason was sound: a proposal created before its client had an
-- identifier keeps the global RPS- fallback for life, so the invoice inherited a
-- prefix naming no client (confirmed live: RPS-2026-0012-01 for a client whose
-- identifier is TEST). Two changes close that hole rather than living with it:
--   1. allocate_client_invoice_number() only inherits a parent prefix that
--      actually starts with the client's own identifier; anything else falls
--      through to the standalone CODE-YYYY-INV-NN shape.
--   2. the reconciliation below moves off-scheme DRAFT proposals onto the
--      client's identifier, so the fallback stops being inherited at the source.
--
-- Sent, accepted, declined and archived proposals are never renumbered: the
-- client was quoted that reference and may be holding it on a purchase order.
--
-- REVERSIBLE. Four functions replaced; the rollback restores 20260820150000 and
-- 20260819172603 verbatim. The data reconciliation touches DRAFT rows only and
-- preserves every previous number in legacy_proposal_number.
--
-- ROLLBACK:
--   -- functions: re-run 20260819172603 (proposal + renumber) and
--   --            20260820150000 (invoice), in that order.
--   -- data: restore each draft's previous number, which was preserved:
--   --   update public.client_proposals
--   --      set proposal_number = legacy_proposal_number, legacy_proposal_number = null
--   --    where status = 'draft' and legacy_proposal_number is not null;
--   -- invoices: the two reconciled drafts were never issued; delete and re-raise.

-- ---------------------------------------------------------------------------
-- 1. The client's identifier, in one place.
-- ---------------------------------------------------------------------------

create or replace function public.client_document_prefix(p_client uuid)
returns text
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce(nullif(btrim(c.client_code), ''), c.company_slug)
    from public.company_clients c
   where c.id = p_client;
$$;

revoke execute on function public.client_document_prefix(uuid) from public, anon;
grant execute on function public.client_document_prefix(uuid) to authenticated;

comment on function public.client_document_prefix(uuid) is
  'The prefix every document for this client carries: client_code (decision of record 2026-09-01), falling back to the retired company_slug so numbers already minted under it stay explicable. Null when the client has neither, which is the signal to refuse to number rather than invent a prefix.';

-- ---------------------------------------------------------------------------
-- 2. Proposal numbers: PREFIX-YYYY-NNN.
-- ---------------------------------------------------------------------------

create or replace function public.allocate_client_proposal_number()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_prefix text;
  v_year   integer;
  v_seq    integer;
begin
  v_year := extract(year from coalesce(new.created_at, now()))::integer;

  if new.client_id is not null then
    v_prefix := public.client_document_prefix(new.client_id);

    if v_prefix is not null then
      insert into public.client_proposal_year_counters (client_id, year, last_seq)
      values (new.client_id, v_year, 1)
      on conflict (client_id, year) do update
        set last_seq = public.client_proposal_year_counters.last_seq + 1
      returning last_seq into v_seq;

      new.proposal_number := v_prefix || '-' || v_year::text || '-'
        || lpad(v_seq::text, greatest(3, length(v_seq::text)), '0');
      return new;
    end if;
  end if;

  -- No client yet, or a client nobody has given a code to. The global fallback
  -- is deliberately ugly: it is a prompt to assign a code, and
  -- renumber_client_draft_proposals() sweeps it up as soon as one is.
  new.proposal_number := public.next_client_proposal_number();
  return new;
end $$;

revoke execute on function public.allocate_client_proposal_number() from public, anon, authenticated;

comment on function public.allocate_client_proposal_number() is
  'BEFORE INSERT on client_proposals: CODE-YYYY-NNN from client_document_prefix(), or the global RPS fallback for a proposal with no client or an uncoded one. Never honours a caller-supplied number.';

-- ---------------------------------------------------------------------------
-- 3. Invoice numbers: PARENT-NN, or CODE-YYYY-INV-NN standalone.
-- ---------------------------------------------------------------------------

create or replace function public.allocate_client_invoice_number()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_prefix text;
  v_parent text;
  v_seq    integer;
  v_year   integer;
  v_name   text;
begin
  select public.client_document_prefix(new.client_id), c.name
    into v_prefix, v_name
    from public.company_clients c
   where c.id = new.client_id;

  if v_prefix is null then
    raise exception
      'cannot number an invoice for %: this company has no proposal code yet',
      coalesce(v_name, new.client_id::text)
      using errcode = 'check_violation',
            hint = 'Assign the company''s proposal code first — it becomes the permanent prefix on this company''s documents, so a person has to choose it. Open the company, set the code, then raise the invoice again.';
  end if;

  -- Proposal-linked, but only when the parent number actually names this
  -- client. A parent still on the global RPS- fallback would hand the invoice a
  -- prefix identifying nobody; that invoice gets the standalone shape instead.
  if new.proposal_id is not null then
    update public.client_proposals
       set invoice_seq = invoice_seq + 1
     where id = new.proposal_id
       and proposal_number is not null
       and left(lower(proposal_number), length(v_prefix) + 1) = lower(v_prefix) || '-'
    returning proposal_number, invoice_seq into v_parent, v_seq;

    if v_parent is not null then
      new.invoice_number := v_parent || '-'
        || lpad(v_seq::text, greatest(2, length(v_seq::text)), '0');
      return new;
    end if;
  end if;

  v_year := extract(year from coalesce(new.issue_date, current_date))::integer;

  insert into public.client_invoice_year_counters (client_id, year, last_seq)
  values (new.client_id, v_year, 1)
  on conflict (client_id, year) do update
    set last_seq = public.client_invoice_year_counters.last_seq + 1
  returning last_seq into v_seq;

  new.invoice_number := v_prefix || '-' || v_year::text || '-INV-'
    || lpad(v_seq::text, greatest(2, length(v_seq::text)), '0');
  return new;
end $$;

revoke execute on function public.allocate_client_invoice_number() from public, anon, authenticated;

comment on function public.allocate_client_invoice_number() is
  'BEFORE INSERT on client_invoices: PARENT-NN off client_proposals.invoice_seq when the parent proposal''s number names this client, so each proposal''s invoices restart at 01; otherwise CODE-YYYY-INV-NN off client_invoice_year_counters. Refuses (check_violation) when the client has no code. Never honours a caller-supplied number.';

-- ---------------------------------------------------------------------------
-- 4. Reclaiming a deleted draft's number, now that there are two shapes.
-- ---------------------------------------------------------------------------

create or replace function public.reclaim_client_invoice_number()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_prefix text;
  v_parts  text[];
  v_year   integer;
  v_seq    integer;
  v_parent text;
  v_tail   text;
begin
  -- Only a draft nobody outside the building ever saw may give its number back.
  if old.status is distinct from 'draft' or old.issued_at is not null then
    return old;
  end if;

  if old.invoice_number is null or old.client_id is null then
    return old;
  end if;

  -- Proposal-linked: PARENT-NN. Give the number back to the parent's own
  -- counter, and only when this invoice held the tail.
  if old.proposal_id is not null then
    select proposal_number into v_parent
      from public.client_proposals
     where id = old.proposal_id;

    if v_parent is not null then
      -- Plain prefix comparison, not a regex: the parent number is data, and
      -- escaping it for regexp_match is a footgun with no upside here.
      if left(old.invoice_number, length(v_parent) + 1) = v_parent || '-' then
        v_tail := substring(old.invoice_number from length(v_parent) + 2);
        if v_tail ~ '^[0-9]+$' then
          v_seq := v_tail::integer;
          update public.client_proposals
             set invoice_seq = v_seq - 1
           where id = old.proposal_id
             and invoice_seq = v_seq;
          return old;
        end if;
      end if;
    end if;
  end if;

  -- Standalone: CODE-YYYY-INV-NN against the client's year counter.
  v_prefix := public.client_document_prefix(old.client_id);
  if v_prefix is null then
    return old;
  end if;

  v_parts := regexp_match(old.invoice_number, '^(.+)-([0-9]{4})-INV-([0-9]+)$');
  if v_parts is null or lower(v_parts[1]) is distinct from lower(v_prefix) then
    return old;
  end if;

  v_year := v_parts[2]::integer;
  v_seq  := v_parts[3]::integer;

  update public.client_invoice_year_counters
     set last_seq = v_seq - 1
   where client_id = old.client_id
     and year = v_year
     and last_seq = v_seq;

  return old;
end $$;

revoke execute on function public.reclaim_client_invoice_number() from public, anon, authenticated;

comment on function public.reclaim_client_invoice_number() is
  'AFTER DELETE on client_invoices: returns the sequence number to whichever counter minted it — client_proposals.invoice_seq for a proposal-linked number, client_invoice_year_counters for a standalone one — but only when the deleted invoice was a never-issued draft holding the tail. Never touches an issued number and never fills a gap.';

-- ---------------------------------------------------------------------------
-- 5. Renumbering a client's drafts onto the current scheme.
-- ---------------------------------------------------------------------------

create or replace function public.renumber_client_draft_proposals(p_client uuid)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_prefix text;
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

  v_prefix := public.client_document_prefix(p_client);
  if v_prefix is null then
    return 0;
  end if;

  for r in
    select p.id, p.proposal_number, p.created_at
      from public.client_proposals p
     where p.client_id = p_client
       and p.status = 'draft'
       and (p.proposal_number is null
            or left(lower(p.proposal_number), length(v_prefix) + 1)
               is distinct from lower(v_prefix) || '-')
     order by p.created_at nulls last, p.id
  loop
    v_year := extract(year from coalesce(r.created_at, now()))::integer;

    insert into public.client_proposal_year_counters (client_id, year, last_seq)
    values (p_client, v_year, 1)
    on conflict (client_id, year) do update
      set last_seq = public.client_proposal_year_counters.last_seq + 1
    returning last_seq into v_seq;

    v_number := v_prefix || '-' || v_year::text || '-'
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
  'Moves a client''s DRAFT proposals onto PREFIX-YYYY-NNN in creation order, keeping the previous number in legacy_proposal_number and mirroring the new one into form_data. Never touches a sent, accepted, declined or archived proposal. SECURITY DEFINER with an explicit is_company_portal_employee() check.';
