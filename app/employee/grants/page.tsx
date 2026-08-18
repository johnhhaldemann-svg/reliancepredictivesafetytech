import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, ExternalLink, HandCoins } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import {
  deadlineUrgency,
  grantStatusLabel,
  grantStatusTone,
  groupGrantsByStatus,
  summariseGrants,
  type GrantRow,
} from "@/lib/grants/pipeline";

/**
 * The grant tracker.
 *
 * company_grant_opportunities has held twelve real pursuits since 14 August,
 * with full RLS policies and eighteen check constraints, and no way to look at
 * any of it. This is the screen. Read-only for now: the money and the deadlines
 * are worth seeing before anyone can edit them from here, and every row already
 * has an owner and a status the database is enforcing.
 */

/**
 * company_grant_opportunities is absent from lib/supabase/types.ts: the table was
 * applied to the database on 14 August with no migration file in the repo, so the
 * generated types have never seen it. Same escape hatch the client record uses for
 * company_files. Regenerating types (npm run types:generate) is the real fix and
 * would also pick up the invoice and opportunity tables — that is a deliberate
 * change to a 7,600-line generated file, so it is not bundled in here.
 */
type LooseClient = any;

type GrantDetailRow = GrantRow & {
  contact: string | null;
  requirements: string | null;
  website_url: string | null;
  website_label: string | null;
  notes: string | null;
  outcome_reason: string | null;
};

function formatMoney(value: number) {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function formatDate(value: string | null) {
  if (!value) return null;

  const date = new Date(`${value.slice(0, 10)}T12:00:00Z`);

  return Number.isFinite(date.getTime()) ? date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null;
}

export default async function GrantTrackerPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = supabase ? await supabase.auth.getUser() : { data: { user: null } };

  if (supabase && !user) {
    redirect("/employee-login?next=/employee/grants");
  }

  const { data, error } = supabase
    ? await (supabase as LooseClient)
        .from("company_grant_opportunities")
        .select(
          "id, name, agency, sub_agency, contact, status, requirements, fee_amount, fee_kind, fee_paid, award_amount, website_url, website_label, opens_on, deadline, next_action, next_action_due, notes, outcome_reason",
        )
        .order("name")
    : { data: [], error: null };

  const rows = (data ?? []) as GrantDetailRow[];
  const totals = summariseGrants(rows);
  const groups = groupGrantsByStatus(rows);
  const now = new Date();

  return (
    <>
      <div className="portal-topline">
        <div>
          <div className="eyebrow">Revenue</div>
          <h1>Grant Tracker</h1>
          <p>
            Every funding pursuit on record, what it costs to apply, and what is still on the table. Sorted by pipeline
            stage, so live pursuits come before anything already decided.
          </p>
        </div>
        <span className="badge">{totals.total} tracked</span>
      </div>

      {error ? (
        <div className="success-box portal-alert portal-alert-error" role="alert">
          The grant tracker could not be read: {error.message}
        </div>
      ) : null}

      <div className="grant-tiles">
        <div className="grant-tile">
          <div className="grant-tile-value">{totals.open}</div>
          <div className="grant-tile-label">Live pursuits</div>
        </div>
        <div className="grant-tile">
          <div className="grant-tile-value">{formatMoney(totals.openOpportunityValue)}</div>
          <div className="grant-tile-label">On the table</div>
        </div>
        <div className="grant-tile grant-tile-good">
          <div className="grant-tile-value">{formatMoney(totals.awardedValue)}</div>
          <div className="grant-tile-label">Awarded to date</div>
        </div>
        <div className={`grant-tile${totals.feesOutstanding > 0 ? " grant-tile-warn" : ""}`}>
          <div className="grant-tile-value">{formatMoney(totals.feesOutstanding)}</div>
          <div className="grant-tile-label">Fees still gating a pursuit</div>
        </div>
        <div className="grant-tile">
          <div className="grant-tile-value">{formatMoney(totals.feesPaid)}</div>
          <div className="grant-tile-label">Fees already paid</div>
        </div>
        <div className="grant-tile">
          <div className="grant-tile-value">{totals.decided}</div>
          <div className="grant-tile-label">Decided</div>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="empty-state">
          <HandCoins size={20} />
          <p>No grant opportunities are on record yet.</p>
        </div>
      ) : (
        groups.map((group) => (
          <section className="table-card grant-group" key={group.status}>
            <div className="checklist-section">
              <div className="stage-workspace-head">
                <div>
                  <span className="eyebrow">Stage</span>
                  <h2>{group.label}</h2>
                </div>
                <span className="badge">{group.rows.length}</span>
              </div>

              <div className="grant-rows">
                {group.rows.map((row) => {
                  const urgency = deadlineUrgency(row, now);
                  const fee = Number(row.fee_amount ?? 0);
                  const award = Number(row.award_amount ?? 0);
                  const opens = formatDate(row.opens_on);
                  const closes = formatDate(row.deadline);

                  return (
                    <article className="grant-row" key={row.id}>
                      <div className="grant-row-head">
                        <div>
                          <h3>{row.name}</h3>
                          <p className="grant-row-agency">
                            {[row.agency, row.sub_agency].filter(Boolean).join(" · ") || "Agency not recorded"}
                            {row.contact ? ` · ${row.contact}` : ""}
                          </p>
                        </div>
                        <div className="grant-row-pills">
                          <span className={`grant-pill grant-pill-${grantStatusTone(row.status)}`}>
                            {grantStatusLabel(row.status)}
                          </span>
                          {urgency ? <span className={`grant-pill grant-pill-${urgency.tone}`}>{urgency.label}</span> : null}
                        </div>
                      </div>

                      <dl className="grant-facts">
                        {award > 0 ? (
                          <div>
                            <dt>Award</dt>
                            <dd>{formatMoney(award)}</dd>
                          </div>
                        ) : null}
                        {fee > 0 ? (
                          <div>
                            <dt>{row.fee_kind === "membership" ? "Membership fee" : row.fee_kind === "application" ? "Application fee" : "Fee"}</dt>
                            <dd>
                              {formatMoney(fee)} {row.fee_paid ? <span className="grant-paid">paid</span> : <span className="grant-unpaid">not paid</span>}
                            </dd>
                          </div>
                        ) : null}
                        {opens ? (
                          <div>
                            <dt>Opens</dt>
                            <dd>{opens}</dd>
                          </div>
                        ) : null}
                        {closes ? (
                          <div>
                            <dt>Deadline</dt>
                            <dd>{closes}</dd>
                          </div>
                        ) : null}
                        {row.next_action ? (
                          <div>
                            <dt>Next action</dt>
                            <dd>
                              {row.next_action}
                              {formatDate(row.next_action_due) ? ` — due ${formatDate(row.next_action_due)}` : ""}
                            </dd>
                          </div>
                        ) : null}
                      </dl>

                      {row.requirements ? (
                        <p className="grant-requirements">
                          <strong>What it takes: </strong>
                          {row.requirements}
                        </p>
                      ) : null}

                      {row.outcome_reason ? (
                        <p className="grant-outcome">
                          <AlertTriangle size={14} aria-hidden />
                          <span>
                            <strong>Why it closed: </strong>
                            {row.outcome_reason}
                          </span>
                        </p>
                      ) : null}

                      {row.notes ? <p className="grant-notes">{row.notes}</p> : null}

                      {row.website_url ? (
                        <Link className="grant-link" href={row.website_url} rel="noreferrer noopener" target="_blank">
                          <ExternalLink size={13} /> {row.website_label || "Programme page"}
                        </Link>
                      ) : row.website_label ? (
                        <p className="grant-source">Source: {row.website_label}</p>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            </div>
          </section>
        ))
      )}
    </>
  );
}
