import { ShieldCheck } from "lucide-react";

/**
 * Every acceptance this proposal has ever received.
 *
 * Reopening a proposal to draft clears `client_proposals.accepted_at` and its
 * companions — deliberately, so a second round can be accepted at all — which
 * used to mean the record of the first signature was destroyed. The rows behind
 * this panel come from `client_proposal_signatures`, an append-only ledger
 * written by a trigger, so they survive the reopen and say what was true when
 * the client actually signed: which number, which title, which value, which
 * revision.
 *
 * Decision of record (Steve Sladky / Custin, 2026-08-31): a signed proposal is
 * never edited. Revisions saved after a signature are internal records; the
 * document the client holds is the signed revision, and this panel says so
 * whenever the working copy has moved on.
 */

export interface ProposalSignatureRow {
  id: string;
  signedAt: string | null;
  signerName: string | null;
  signerEmail: string | null;
  proposalNumber: string | null;
  proposalTitle: string | null;
  proposalValue: number | null;
  revisionNumber: number | null;
}

function formatMoment(value: string | null): string {
  if (!value) return "an unrecorded date";
  const d = new Date(value);
  return Number.isFinite(d.getTime())
    ? d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })
    : "an unrecorded date";
}

function formatMoney(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) return null;
  return value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

export function ProposalSignatureLedger({
  signatures,
  currentRevision,
}: {
  signatures: ProposalSignatureRow[];
  currentRevision: number;
}) {
  if (signatures.length === 0) return null;

  const latest = signatures[0];
  const movedOn = latest.revisionNumber !== null && currentRevision > latest.revisionNumber;

  return (
    <section className="form-panel">
      <h2>
        <ShieldCheck size={16} aria-hidden style={{ verticalAlign: "-2px", marginRight: 6 }} />
        Signed copies
      </h2>
      <p style={{ color: "var(--portal-muted)", fontSize: "0.9rem" }}>
        What the client actually accepted, kept exactly as it stood at the moment they signed. Reopening this proposal
        does not change anything here.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
        {signatures.map((signature) => (
          <article
            key={signature.id}
            style={{
              border: "1px solid var(--portal-line, #dbe2e9)",
              borderLeft: "3px solid var(--portal-gold)",
              borderRadius: 8,
              padding: "12px 14px",
            }}
          >
            <div style={{ fontWeight: 600 }}>
              {signature.proposalNumber ?? "Unnumbered"}
              {signature.revisionNumber !== null ? ` · revision v${signature.revisionNumber}` : ""}
            </div>
            <div style={{ color: "var(--portal-muted)", fontSize: "0.9rem", marginTop: 2 }}>
              Accepted {formatMoment(signature.signedAt)}
              {signature.signerName ? ` by ${signature.signerName}` : ""}
              {signature.signerEmail ? ` (${signature.signerEmail})` : ""}
            </div>
            {formatMoney(signature.proposalValue) ? (
              <div style={{ color: "var(--portal-muted)", fontSize: "0.9rem" }}>
                Value at signing: {formatMoney(signature.proposalValue)}
              </div>
            ) : null}
            {signature.proposalTitle ? (
              <div style={{ color: "var(--portal-muted)", fontSize: "0.85rem", marginTop: 2 }}>
                {signature.proposalTitle}
              </div>
            ) : null}
          </article>
        ))}
      </div>

      {movedOn ? (
        <p style={{ marginTop: 12, fontSize: "0.9rem" }}>
          This proposal has since been revised to v{currentRevision}.{" "}
          <strong>Those revisions are internal records.</strong> The document the client holds is v{latest.revisionNumber},
          and it is not edited to match — a change in price belongs on the invoice, where it is recorded as a variance.
        </p>
      ) : null}
    </section>
  );
}
