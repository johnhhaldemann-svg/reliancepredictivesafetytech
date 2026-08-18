import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, ReceiptText } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { canAccessEmployeePath, hasFullPortalVisibility, isPortalOwnerRole } from "@/lib/user-management";
import {
  billedForProposal,
  invoicesByProposal,
  proposalLabel,
  proposalsReadyToInvoice,
  type ProposalRow,
} from "@/lib/invoices/proposal-link";
import {
  ageingBuckets,
  daysOverdue,
  invoiceKindLabel,
  invoiceStatusLabel,
  invoiceStatusTone,
  sortInvoices,
  summariseInvoices,
  type InvoiceRow,
} from "@/lib/invoices/invoice";

/**
 * The invoice generator.
 *
 * The database has held the whole invoicing model since 14 August: header,
 * line items, per-year counters, a SECURITY DEFINER allocate_client_invoice_number(),
 * a guard_client_invoice_total() trigger, twenty-one check constraints, and RLS
 * that lets any employee draft an invoice but only an admin settle one. What it
 * has never had is a screen. This is the ledger view.
 *
 * Read-only for now, and deliberately so: money that admins alone may settle
 * should be visible to everyone who can raise it before anyone can settle it
 * from here. Raising a draft comes next, and it will go through the numbering
 * function rather than inventing a number in application code.
 */

type LooseClient = any;

type InvoiceDetailRow = InvoiceRow & {
  client_id: string | null;
  proposal_id: string | null;
  job_name: string | null;
  consultant_name: string | null;
  payment_terms: string | null;
  void_reason: string | null;
  notes: string | null;
};

function formatMoney(value: number, currency = "USD") {
  return value.toLocaleString("en-US", { style: "currency", currency, maximumFractionDigits: 2 });
}

function formatDate(value: string | null) {
  if (!value) return null;

  const d = new Date(`${value.slice(0, 10)}T12:00:00Z`);

  return Number.isFinite(d.getTime()) ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null;
}

export default async function InvoicesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = supabase ? await supabase.auth.getUser() : { data: { user: null } };

  if (supabase && !user) {
    redirect("/employee-login?next=/employee/invoices");
  }

  const { data: currentRole } =
    supabase && user
      ? await supabase.from("user_roles").select("role, account_status").eq("user_id", user.id).maybeSingle()
      : { data: null };

  const [{ data: financeAuthorization }, { data: moduleAccess }] =
    supabase && user
      ? await Promise.all([
          supabase.from("company_finance_authorized_users").select("user_id").eq("user_id", user.id).maybeSingle(),
          hasFullPortalVisibility(currentRole?.role, currentRole?.account_status)
            ? Promise.resolve({ data: [] })
            : supabase.from("portal_user_module_access").select("module_key").eq("user_id", user.id),
        ])
      : [{ data: null }, { data: [] }];

  const moduleKeys = (moduleAccess ?? []).map((a) => a.module_key);

  /**
   * Same gate the finance centre uses. RLS would return nothing to an
   * unauthorised reader anyway, but "you cannot see this" and "there are no
   * invoices" must not look identical.
   */
  const canSeeMoney = Boolean(
    currentRole?.account_status === "active" &&
      canAccessEmployeePath(currentRole?.role, currentRole?.account_status, "/employee/finance", moduleKeys) &&
      (isPortalOwnerRole(currentRole.role) || financeAuthorization),
  );

  const { data } =
    supabase && canSeeMoney
      ? await (supabase as LooseClient)
          .from("client_invoices")
          .select(
            "id, client_id, proposal_id, invoice_number, status, kind, issue_date, due_date, currency, subtotal, tax_amount, total, job_name, consultant_name, payment_terms, void_reason, notes",
          )
          .order("issue_date", { ascending: false })
      : { data: [] };

  const rows = (data ?? []) as InvoiceDetailRow[];
  const now = new Date();
  const summary = summariseInvoices(rows, now);
  const sorted = sortInvoices(rows, now);

  // The proposals side of the link. Won proposals are what make an unbilled
  // gap visible; every proposal is fetched so an invoice can name its own.
  const { data: proposalData } =
    supabase && canSeeMoney
      ? await supabase.from("client_proposals").select("id, client_id, title, status, proposal_number, accepted_at")
      : { data: [] };

  const proposals = (proposalData ?? []) as ProposalRow[];
  const proposalById = new Map(proposals.map((p) => [p.id, p]));
  const raisedByProposal = invoicesByProposal(rows);
  const unbilled = proposalsReadyToInvoice(proposals, rows);

  const clientIds = [
    ...new Set([...rows.map((r) => r.client_id), ...unbilled.map((u) => u.proposal.client_id)].filter(Boolean)),
  ] as string[];
  const { data: clients } =
    supabase && clientIds.length > 0
      ? await supabase.from("company_clients").select("id, name").in("id", clientIds)
      : { data: [] };
  const clientName = new Map((clients ?? []).map((c) => [c.id as string, c.name as string]));

  return (
    <>
      <div className="portal-topline">
        <div>
          <div className="eyebrow">Revenue</div>
          <h1>Invoices</h1>
          <p>
            Every invoice raised against a client, aged by how long the money has been outstanding. Numbers are
            allocated by the database, so two people drafting at once cannot collide.
          </p>
        </div>
        <span className="badge">{summary.count} on record</span>
      </div>

      {!canSeeMoney ? (
        <div className="empty-state">
          <AlertTriangle size={20} />
          <p>
            Invoices are restricted to finance-authorised users and owners. This is a permission boundary, not an empty
            ledger — ask an owner to grant finance access if you need it.
          </p>
        </div>
      ) : (
        <>
          <div className="grant-tiles">
            <div className={`grant-tile${summary.overdueCount > 0 ? " grant-tile-warn" : ""}`}>
              <div className="grant-tile-value">{formatMoney(summary.outstandingValue)}</div>
              <div className="grant-tile-label">Outstanding</div>
            </div>
            <div className="grant-tile grant-tile-good">
              <div className="grant-tile-value">{formatMoney(summary.paidValue)}</div>
              <div className="grant-tile-label">Collected</div>
            </div>
            <div className={`grant-tile${summary.overdueCount > 0 ? " grant-tile-warn" : ""}`}>
              <div className="grant-tile-value">{summary.overdueCount}</div>
              <div className="grant-tile-label">Past due</div>
            </div>
            <div className="grant-tile">
              <div className="grant-tile-value">{summary.drafts}</div>
              <div className="grant-tile-label">Drafts</div>
            </div>
          </div>

          <section className="table-card grant-group">
            <div className="checklist-section">
              <div className="stage-workspace-head">
                <div>
                  <span className="eyebrow">Receivables</span>
                  <h2>Ageing</h2>
                </div>
              </div>
              <div className="invoice-ageing">
                {ageingBuckets.map((bucket) => (
                  <div className="invoice-ageing-cell" key={bucket}>
                    <div className="invoice-ageing-label">{bucket === "current" ? "Not yet due" : `${bucket} days`}</div>
                    <div className="invoice-ageing-value">{formatMoney(summary.ageing[bucket])}</div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {unbilled.length > 0 ? (
            <section className="table-card grant-group invoice-gap">
              <div className="checklist-section">
                <div className="stage-workspace-head">
                  <div>
                    <span className="eyebrow">Won, not billed</span>
                    <h2>Proposals the client accepted and nobody has invoiced</h2>
                  </div>
                  <span className="badge">{unbilled.length}</span>
                </div>
                <div className="grant-rows">
                  {unbilled.map(({ proposal, voidedOnly }) => (
                    <article className="grant-row" key={proposal.id}>
                      <div className="grant-row-head">
                        <div>
                          <h3>{proposalLabel(proposal)}</h3>
                          <p className="grant-row-agency">
                            {(proposal.client_id && clientName.get(proposal.client_id)) || "No client linked"}
                            {proposal.title && proposal.proposal_number ? ` · ${proposal.title}` : ""}
                          </p>
                        </div>
                        <div className="grant-row-pills">
                          <span className="grant-pill grant-pill-urgent">
                            {voidedOnly ? "Only invoice was voided" : "Never invoiced"}
                          </span>
                        </div>
                      </div>
                      <Link className="grant-link" href={`/employee/proposals/${proposal.id}`}>
                        Open the proposal
                      </Link>
                    </article>
                  ))}
                </div>
              </div>
            </section>
          ) : null}

          {rows.length === 0 ? (
            <div className="empty-state">
              <ReceiptText size={20} />
              <p>
                No invoices have been raised yet. The tables, numbering function and constraints are all in place —
                the first invoice can be raised against any accepted proposal.
              </p>
              <Link className="button button-light" href="/employee/proposals">
                Open proposals
              </Link>
            </div>
          ) : (
            <section className="table-card grant-group">
              <div className="checklist-section">
                <div className="stage-workspace-head">
                  <div>
                    <span className="eyebrow">Ledger</span>
                    <h2>All invoices</h2>
                  </div>
                  <span className="badge">{rows.length}</span>
                </div>

                <div className="grant-rows">
                  {sorted.map((row) => {
                    const late = daysOverdue(row, now);

                    return (
                      <article className="grant-row" key={row.id}>
                        <div className="grant-row-head">
                          <div>
                            <h3>{row.invoice_number ?? "Unnumbered draft"}</h3>
                            <p className="grant-row-agency">
                              {(row.client_id && clientName.get(row.client_id)) || "No client linked"}
                              {row.job_name ? ` · ${row.job_name}` : ""}
                            </p>
                          </div>
                          <div className="grant-row-pills">
                            <span className={`grant-pill grant-pill-${invoiceStatusTone(row.status)}`}>
                              {invoiceStatusLabel(row.status)}
                            </span>
                            <span className="grant-pill">{invoiceKindLabel(row.kind)}</span>
                            {late !== null ? <span className="grant-pill grant-pill-urgent">{late}d overdue</span> : null}
                          </div>
                        </div>

                        <dl className="grant-facts">
                          <div>
                            <dt>Total</dt>
                            <dd>{formatMoney(Number(row.total ?? 0), row.currency)}</dd>
                          </div>
                          {Number(row.tax_amount ?? 0) > 0 ? (
                            <div>
                              <dt>Tax</dt>
                              <dd>{formatMoney(Number(row.tax_amount ?? 0), row.currency)}</dd>
                            </div>
                          ) : null}
                          {formatDate(row.issue_date) ? (
                            <div>
                              <dt>Issued</dt>
                              <dd>{formatDate(row.issue_date)}</dd>
                            </div>
                          ) : null}
                          {formatDate(row.due_date) ? (
                            <div>
                              <dt>Due</dt>
                              <dd>{formatDate(row.due_date)}</dd>
                            </div>
                          ) : null}
                          {row.consultant_name ? (
                            <div>
                              <dt>Consultant</dt>
                              <dd>{row.consultant_name}</dd>
                            </div>
                          ) : null}
                        </dl>

                        {row.void_reason ? (
                          <p className="grant-outcome">
                            <AlertTriangle size={14} aria-hidden />
                            <span>
                              <strong>Voided: </strong>
                              {row.void_reason}
                            </span>
                          </p>
                        ) : null}

                        {row.payment_terms ? <p className="grant-notes">{row.payment_terms}</p> : null}

                        {row.proposal_id && proposalById.get(row.proposal_id) ? (
                          <Link className="grant-link" href={`/employee/proposals/${row.proposal_id}`}>
                            Raised from {proposalLabel(proposalById.get(row.proposal_id)!)}
                          </Link>
                        ) : (
                          <p className="grant-source">Not linked to a proposal</p>
                        )}
                      </article>
                    );
                  })}
                </div>
              </div>
            </section>
          )}
        </>
      )}
    </>
  );
}
