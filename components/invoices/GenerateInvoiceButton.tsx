"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Receipt } from "lucide-react";
import { generateInvoiceFromProposal } from "@/app/employee/invoices/actions";
import { invoiceKindLabel, invoiceKinds } from "@/lib/invoices/invoice";

/**
 * Opens a small inline picker for which kind of invoice to raise (a proposal
 * can carry at most one LIVE invoice per kind — see
 * client_invoices_one_live_per_kind), then hands off to the edit page so the
 * generated draft can be adjusted before anyone sees it.
 */
export function GenerateInvoiceButton({ proposalId }: { proposalId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<string>("full");
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  function submit() {
    setError("");
    startTransition(async () => {
      const result = await generateInvoiceFromProposal(proposalId, kind);
      if (!result.ok || !result.invoiceId) {
        setError(result.error ?? "Could not generate the invoice.");
        return;
      }
      setOpen(false);
      router.push(`/employee/invoices/${result.invoiceId}`);
    });
  }

  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      <button type="button" className="button button-light" disabled={isPending} onClick={() => setOpen((value) => !value)}>
        <Receipt size={16} /> Generate invoice
      </button>
      {open ? (
        <div
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 6px)",
            zIndex: 20,
            minWidth: 260,
            background: "var(--portal-card, #fff)",
            border: "1px solid var(--portal-line, #dbe2e9)",
            borderRadius: 8,
            padding: 12,
            boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
          }}
        >
          <div className="field">
            <label htmlFor="generate-invoice-kind">Invoice for</label>
            <select
              id="generate-invoice-kind"
              value={kind}
              disabled={isPending}
              onChange={(event) => setKind(event.target.value)}
            >
              {invoiceKinds.map((option) => (
                <option key={option} value={option}>
                  {invoiceKindLabel(option)}
                </option>
              ))}
            </select>
          </div>
          {error ? (
            <p style={{ color: "var(--portal-danger, #c0392b)", fontSize: "0.85rem", marginTop: 8 }}>{error}</p>
          ) : null}
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button type="button" className="button button-primary" disabled={isPending} onClick={submit}>
              {isPending ? "Generating…" : "Generate"}
            </button>
            <button type="button" className="button button-light" disabled={isPending} onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
