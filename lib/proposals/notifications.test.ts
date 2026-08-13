import { describe, expect, it } from "vitest";
import {
  buildProposalNotificationContent,
  formatProposalValue,
  type ProposalEventContext,
} from "./notifications";

const base: ProposalEventContext = {
  proposalId: "11111111-2222-3333-4444-555555555555",
  title: "Safety Program Buildout",
  proposalNumber: "PRO-0042",
  clientName: "Acme Construction",
  proposalValue: 48000,
  revisionNumber: 3,
};

describe("formatProposalValue", () => {
  it("formats a real amount as whole dollars", () => {
    expect(formatProposalValue(48000)).toBe("$48,000");
  });

  it("returns null for values that should not be quoted to an owner", () => {
    // A zero or missing total means the fee table was never filled in; printing
    // "$0" in a notification would read as a real free-of-charge deal.
    expect(formatProposalValue(0)).toBeNull();
    expect(formatProposalValue(null)).toBeNull();
    expect(formatProposalValue(undefined)).toBeNull();
    expect(formatProposalValue(Number.NaN)).toBeNull();
    expect(formatProposalValue(-100)).toBeNull();
  });
});

describe("buildProposalNotificationContent", () => {
  it("asks the approver to review, at high priority, pointing at the proposal", () => {
    const content = buildProposalNotificationContent("submitted_for_review", base);

    expect(content.title).toBe("Proposal ready for your review");
    expect(content.body).toContain("PRO-0042 — Safety Program Buildout");
    expect(content.body).toContain("Acme Construction");
    expect(content.body).toContain("v3");
    expect(content.priority).toBe("high");
    expect(content.actionHref).toBe(`/employee/proposals/${base.proposalId}`);
    expect(content.emailSubject).toContain("Review needed");
  });

  // The three events that close the maker-checker loop. Before these, the author
  // submitted into silence: the answer reached nobody.
  it("tells the author their proposal was approved and can go out", () => {
    const content = buildProposalNotificationContent("approved", base);

    expect(content.title).toBe("Proposal approved");
    expect(content.body).toContain("PRO-0042 — Safety Program Buildout");
    expect(content.body).toContain("v3");
    expect(content.priority).toBe("high");
    expect(content.emailSubject).toContain("Approved");
  });

  it("leads a change request with the note, because the note is what to act on", () => {
    const content = buildProposalNotificationContent("changes_requested", {
      ...base,
      decisionNote: "Fix the pricing table",
    });

    expect(content.title).toBe("Changes requested on your proposal");
    // The note leads; the reference follows it.
    expect(content.body.indexOf("Fix the pricing table")).toBeLessThan(
      content.body.indexOf("PRO-0042"),
    );
    expect(content.priority).toBe("high");
    expect(content.emailSubject).toContain("Changes requested");
  });

  it("still reads sensibly when a change request carries no note", () => {
    const content = buildProposalNotificationContent("changes_requested", base);

    expect(content.body).toContain("Changes were requested on");
    expect(content.body).toContain("PRO-0042 — Safety Program Buildout");
    expect(content.body).not.toContain('""');
  });

  it("tells the author the document reached the client, as news rather than a task", () => {
    const content = buildProposalNotificationContent("sent", base);

    expect(content.title).toBe("Proposal sent to the client");
    expect(content.body).toContain("Acme Construction");
    expect(content.body).toContain("$48,000");
    // Only the approver can send, so this starts a clock; it does not ask for
    // anything, and must not outrank a change request that blocks the deal.
    expect(content.priority).toBe("medium");
  });

  it("gives every event its own dedupe key so one does not suppress another", () => {
    const keys = (["submitted_for_review", "approved", "changes_requested", "sent", "accepted", "declined"] as const).map(
      (kind) => buildProposalNotificationContent(kind, base).dedupeKey,
    );

    expect(new Set(keys).size).toBe(keys.length);
  });

  it("leads an acceptance with the money and names who accepted", () => {
    const content = buildProposalNotificationContent("accepted", {
      ...base,
      actorName: "Dana Reyes",
      channel: "share_link",
    });

    expect(content.title).toBe("Proposal accepted — $48,000");
    expect(content.body).toContain("Dana Reyes accepted");
    expect(content.priority).toBe("critical");
  });

  it("falls back to a generic actor and omits value when there is none", () => {
    const content = buildProposalNotificationContent("accepted", {
      ...base,
      proposalValue: null,
      actorName: null,
    });

    expect(content.title).toBe("Proposal accepted");
    expect(content.body).toContain("The client accepted");
    expect(content.body).not.toContain("Value:");
  });

  it("carries the decline reason, which is the point of capturing it", () => {
    const content = buildProposalNotificationContent("declined", {
      ...base,
      actorName: "Dana Reyes",
      declineReason: "Went with an incumbent vendor",
    });

    expect(content.title).toBe("Proposal declined");
    expect(content.body).toContain("Dana Reyes declined");
    expect(content.body).toContain("Went with an incumbent vendor");
  });

  it("keys dedupe on proposal, event and channel so a redelivered webhook cannot stack copies", () => {
    const first = buildProposalNotificationContent("accepted", { ...base, channel: "docusign" });
    const second = buildProposalNotificationContent("accepted", {
      ...base,
      channel: "docusign",
      // Same event re-notified with a different actor spelling still dedupes.
      actorName: "Someone Else",
    });

    expect(first.dedupeKey).toBe(second.dedupeKey);
    expect(first.dedupeKey).toContain(base.proposalId);
  });

  it("separates the same outcome arriving by different routes", () => {
    const viaLink = buildProposalNotificationContent("accepted", { ...base, channel: "share_link" });
    const viaDocusign = buildProposalNotificationContent("accepted", { ...base, channel: "docusign" });
    const declined = buildProposalNotificationContent("declined", { ...base, channel: "share_link" });

    expect(viaLink.dedupeKey).not.toBe(viaDocusign.dedupeKey);
    expect(viaLink.dedupeKey).not.toBe(declined.dedupeKey);
  });

  it("degrades gracefully when the proposal has no number and no client", () => {
    const content = buildProposalNotificationContent("submitted_for_review", {
      proposalId: base.proposalId,
      title: "Untitled draft",
    });

    expect(content.body).toContain("Untitled draft");
    // No dangling "for <client>" and no placeholder leaking into an owner's inbox.
    expect(content.body).not.toContain("for null");
    expect(content.body).not.toContain("for undefined");
    expect(content.body).not.toContain("undefined");
    expect(content.body).not.toContain("null");
    expect(content.body).not.toContain("—");
    expect(buildProposalNotificationContent("submitted_for_review", base).body).toContain(
      "for Acme Construction",
    );
  });
});
