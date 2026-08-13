import Link from "next/link";
import { summarizeReceivables, type RevenueIncomeRow } from "@/lib/reports/revenue";

/**
 * What this company owes, on the company's own record.
 *
 * Accepting a proposal writes an expected-income schedule
 * (lib/proposals/acceptance-income.ts), but that schedule only ever appeared in
 * the Finance Center — a module gated on a company_finance_authorized_users row
 * that the person closing the deal may not have. So a deal could be won here and
 * the money it created was invisible from here.
 *
 * The authorization state is passed in rather than inferred from an empty
 * result, because those two cases must not look alike: RLS on
 * company_finance_transactions returns zero rows to an unauthorized reader, and
 * rendering that as "no receivables" would state, on a won deal, that it
 * generated no money.
 */
const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export function ClientReceivablesPanel({
  income,
  canSeeFinance,
  now,
}: {
  income: RevenueIncomeRow[];
  /** Whether this viewer holds finance authorization. */
  canSeeFinance: boolean;
  /** Passed in so the server render and any re-render agree on "now". */
  now: Date;
}) {
  if (!canSeeFinance) {
    return (
      <section className="table-card" style={{ marginTop: 20 }}>
        <div className="checklist-section">
          <div className="stage-workspace-head">
            <div>
              <div className="eyebrow">Money</div>
              <h2>Receivables</h2>
            </div>
          </div>
          <div className="empty-state">
            You do not have finance access, so the payment schedule for this company is hidden — this is not a
            statement that there is none. An owner can grant access from the{" "}
            <Link href="/employee/finance">Finance Center</Link>.
          </div>
        </div>
      </section>
    );
  }

  const summary = summarizeReceivables(income, now);
  const outstanding = summary.expectedValue + summary.invoicedValue;
  const hasAny = income.length > 0;

  return (
    <section className="table-card" style={{ marginTop: 20 }}>
      <div className="checklist-section">
        <div className="stage-workspace-head">
          <div>
            <div className="eyebrow">Money</div>
            <h2>Receivables</h2>
          </div>
          {summary.overdueCount > 0 ? (
            <span className="badge" style={{ color: "var(--portal-gold)" }}>
              {summary.overdueCount} overdue · {money.format(summary.overdueValue)}
            </span>
          ) : null}
        </div>

        {!hasAny ? (
          <div className="empty-state">
            Nothing scheduled yet. Accepting a proposal files its payment schedule here automatically.
          </div>
        ) : (
          <>
            <div className="stage-workspace-grid">
              <section>
                <h3>Outstanding</h3>
                <div className="metric" style={{ fontSize: "1.4rem" }}>
                  {money.format(outstanding)}
                </div>
                <p style={{ color: "var(--portal-muted)" }}>
                  {summary.expectedCount} expected · {summary.invoicedCount} invoiced
                </p>
              </section>
              <section>
                <h3>Received</h3>
                <div className="metric" style={{ fontSize: "1.4rem" }}>
                  {money.format(summary.receivedValue)}
                </div>
                <p style={{ color: "var(--portal-muted)" }}>
                  {summary.receivedCount} payment{summary.receivedCount === 1 ? "" : "s"} in
                </p>
              </section>
            </div>
            <p style={{ marginTop: 10 }}>
              <Link href="/employee/finance">Open the Finance Center</Link>
            </p>
          </>
        )}
      </div>
    </section>
  );
}
