-- A deleted draft invoice gives its number back.
--
-- MODULE_ID: client_invoices
--
-- WHY. allocate_client_invoice_number() bumps client_invoice_year_counters on
-- every INSERT and nothing ever bumps it back down, so deleting a draft burns
-- the number it held. Wondfo USA's counter reached 7 against two surviving
-- invoices: INV-01, -02, -04, -05 and -06 were all raised and then deleted
-- while still drafts, and the next invoice raised read WONDFOUSA-2026-INV-07 on
-- a ledger showing barely anything. A number is a promise to the client about
-- how much business has passed between us; a counter that only ever counts
-- attempts is not that.
--
-- A monotonic counter is the RIGHT behaviour for an ISSUED invoice: once a
-- number has been on a document a client has seen, quoted on a PO or paid
-- against, it must never be reused, gap or no gap. So this reclaims the number
-- only when BOTH hold:
--
--   * the deleted invoice was still a draft and had never been issued
--     (status = 'draft' and issued_at is null), i.e. no one outside the
--     building has ever seen the number, and
--   * it held the HIGHEST number allocated for that client and year — the tail.
--
-- Reclaiming only the tail is what makes this safe under concurrency and safe
-- against gaps. It can never fill a hole in the middle of a sequence, so it can
-- never mint a duplicate; and the guarded UPDATE takes the same counter row
-- lock a concurrent allocation takes, so if an insert wins the race the
-- reclaim simply matches zero rows and the counter stays where the winner put
-- it. Deleting a non-tail draft still leaves its gap, deliberately: closing it
-- would renumber invoices that already exist.
--
-- The number is parsed back out of invoice_number rather than recomputed from
-- issue_date, because issue_date may have been edited after the number was
-- minted, and a prefix that no longer matches the client's current slug is left
-- alone entirely — a number minted under a retired scheme is not ours to
-- reclaim.
--
-- ONE-TIME RECONCILIATION. The trigger only helps from here on, so the
-- backfill below clamps each existing counter down to the highest sequence
-- still in use. It runs ONLY for a (client, year) where every surviving invoice
-- is an unissued draft; any client/year that has ever issued one is skipped and
-- keeps its counter untouched. Verified against platform_audit_events on
-- 2026-08-31 before writing this: no invoice in this database has ever been
-- issued, and every delete recorded there was a never-issued draft.
--
-- ADDITIVE AND REVERSIBLE. One new function and trigger; the counter clamp is
-- data, and the rollback below restores the counters from the audit trail's
-- high-water marks if that is ever wanted.
--
-- ROLLBACK:
--   drop trigger if exists reclaim_client_invoice_number on public.client_invoices;
--   drop function if exists public.reclaim_client_invoice_number();
--   -- counters: raise each back to its pre-clamp high-water mark if needed, e.g.
--   -- update public.client_invoice_year_counters set last_seq = 7
--   --  where client_id = '<uuid>' and year = 2026;

create or replace function public.reclaim_client_invoice_number()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_slug  text;
  v_parts text[];
  v_year  integer;
  v_seq   integer;
begin
  -- Only a draft nobody outside the building ever saw may give its number back.
  if old.status is distinct from 'draft' or old.issued_at is not null then
    return old;
  end if;

  if old.invoice_number is null or old.client_id is null then
    return old;
  end if;

  select company_slug into v_slug
    from public.company_clients
   where id = old.client_id;

  if v_slug is null then
    return old;
  end if;

  -- SLUG-YYYY-INV-NN, and only for the client's CURRENT slug: a number minted
  -- under a retired prefix does not belong to today's counter.
  v_parts := regexp_match(old.invoice_number, '^(.+)-([0-9]{4})-INV-([0-9]+)$');
  if v_parts is null or v_parts[1] is distinct from v_slug then
    return old;
  end if;

  v_year := v_parts[2]::integer;
  v_seq  := v_parts[3]::integer;

  -- Tail only. Matching last_seq in the WHERE is both the "is it the tail?"
  -- test and the concurrency guard.
  update public.client_invoice_year_counters
     set last_seq = v_seq - 1
   where client_id = old.client_id
     and year = v_year
     and last_seq = v_seq;

  return old;
end $$;

revoke execute on function public.reclaim_client_invoice_number() from public, anon, authenticated;

comment on function public.reclaim_client_invoice_number() is
  'AFTER DELETE on client_invoices: returns the sequence number to client_invoice_year_counters when the deleted invoice was a never-issued draft holding the tail number for its client and year. Never touches an issued number and never fills a gap, so a number a client has seen can never be reused.';

drop trigger if exists reclaim_client_invoice_number on public.client_invoices;
create trigger reclaim_client_invoice_number
after delete on public.client_invoices
for each row execute function public.reclaim_client_invoice_number();

-- One-time clamp of the counters the old behaviour already inflated. Skips any
-- client/year that has ever issued an invoice.
update public.client_invoice_year_counters c
   set last_seq = sub.highest_in_use
  from (
    select c2.client_id,
           c2.year,
           coalesce(
             max(
               (regexp_match(i.invoice_number, '^(.+)-([0-9]{4})-INV-([0-9]+)$'))[3]::integer
             ),
             0
           ) as highest_in_use
      from public.client_invoice_year_counters c2
      join public.company_clients cc on cc.id = c2.client_id
      left join public.client_invoices i
        on i.client_id = c2.client_id
       and i.invoice_number ~ ('^' || cc.company_slug || '-' || c2.year::text || '-INV-[0-9]+$')
     where cc.company_slug is not null
       and not exists (
         select 1
           from public.client_invoices x
          where x.client_id = c2.client_id
            and (x.status is distinct from 'draft' or x.issued_at is not null)
       )
     group by c2.client_id, c2.year
  ) sub
 where c.client_id = sub.client_id
   and c.year = sub.year
   and c.last_seq > sub.highest_in_use;
