"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, X } from "lucide-react";
import { setProposalStatus } from "@/app/employee/proposals/actions";
import { declineReasonMaxLength } from "@/app/employee/proposals/share-link-policy";
import { canTransitionProposal } from "@/lib/proposals/policy";
import type { ProposalStatus } from "@/lib/proposals/types";

/**
 * Records the client's answer on a proposal, from the company record.
 *
 * Closing a deal used to mean leaving the record for the proposals module. The
 * outcome is the single most consequential transition in the workflow — it is
 * what writes the income schedule and advances the pipeline stage — so it
 * belongs where the deal is being looked at.
 *
 * Renders nothing unless the proposal is actually decidable. `accepted` and
 * `declined` are only reachable from `sent` (lib/proposals/policy.ts), so a
 * draft shows no buttons rather than buttons that will be refused.
 */
export function ClientProposalDecision({
  proposalId,
  status,
  title,
}: {
  proposalId: string;
  status: ProposalStatus;
  title: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<"accepted" | "declined" | null>(null);
  const [decliningOpen, setDecliningOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");

  const decidable = canTransitionProposal(status, "accepted").ok;
  if (!decidable) return null;

  async function decide(next: "accepted" | "declined") {
    setPending(next);
    setError("");

    const result =
      next === "declined"
        ? await setProposalStatus(proposalId, "declined", { declineReason: reason.trim() })
        : await setProposalStatus(proposalId, "accepted");

    if (!result.ok) {
      setError(result.error ?? "The status could not be updated.");
      setPending(null);
      return;
    }

    // Accepting writes the income schedule and moves the lifecycle stage, so the
    // whole record is stale — not just this row.
    setDecliningOpen(false);
    setReason("");
    setPending(null);
    router.refresh();
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
      {error ? (
        <div className="portal-alert portal-alert-error" role="alert">
          {error}
        </div>
      ) : null}

      {decliningOpen ? (
        <div className="field">
          <label htmlFor={`decline-reason-${proposalId}`}>Why did they say no?</label>
          <textarea
            id={`decline-reason-${proposalId}`}
            maxLength={declineReasonMaxLength}
            onChange={(event) => setReason(event.target.value)}
            placeholder="e.g. Went with an incumbent vendor on price"
            rows={2}
            value={reason}
          />
          <p style={{ color: "var(--portal-muted)", fontSize: "0.85rem", marginTop: 4 }}>
            Recorded against the deal so the loss is answerable later.
          </p>
        </div>
      ) : null}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          aria-label={`Mark ${title} accepted`}
          className="button button-primary"
          disabled={pending !== null}
          onClick={() => decide("accepted")}
          type="button"
        >
          {pending === "accepted" ? (
            <Loader2 aria-hidden="true" className="spin" size={14} />
          ) : (
            <Check aria-hidden="true" size={14} />
          )}
          {pending === "accepted" ? "Recording…" : "Accepted"}
        </button>

        {decliningOpen ? (
          <>
            <button
              className="button button-light"
              disabled={pending !== null || reason.trim() === ""}
              onClick={() => decide("declined")}
              type="button"
            >
              {pending === "declined" ? (
                <Loader2 aria-hidden="true" className="spin" size={14} />
              ) : (
                <X aria-hidden="true" size={14} />
              )}
              {pending === "declined" ? "Recording…" : "Confirm decline"}
            </button>
            <button
              className="button button-light"
              disabled={pending !== null}
              onClick={() => {
                setDecliningOpen(false);
                setReason("");
                setError("");
              }}
              type="button"
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            aria-label={`Mark ${title} declined`}
            className="button button-light"
            disabled={pending !== null}
            onClick={() => setDecliningOpen(true)}
            type="button"
          >
            <X aria-hidden="true" size={14} /> Declined
          </button>
        )}
      </div>
    </div>
  );
}
