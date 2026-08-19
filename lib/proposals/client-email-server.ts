import "server-only";

// Actually puts a proposal share link in a client's inbox.
//
// Before this existed, "Send" only flipped the proposal's internal status and
// told the OWNERS it was sent (see notifications-server.ts) — nothing ever
// emailed the client. A share link was generated for an employee to copy and
// paste into their own email client by hand, and if nobody remembered that
// second step, the client never received anything at all. This module is the
// missing step: given a link and the addressees already saved on the
// proposal, it actually delivers.

import { getResendClient, NOTIFICATION_FROM } from "@/lib/email/resend";
import { ProposalShareEmail } from "@/emails/proposal-share";
import type { ProposalClientContact } from "./client-contacts";

export interface SendProposalShareEmailInput {
  recipients: ProposalClientContact[];
  title: string;
  proposalNumber: string | null;
  url: string;
  expiresAt: string | null;
}

export interface SendProposalShareEmailResult {
  ok: boolean;
  emailed: string[];
  error?: string;
}

/**
 * Best-effort per recipient: one bad address should not stop the others from
 * receiving a proposal they are legitimately owed.
 */
export async function sendProposalShareEmail(input: SendProposalShareEmailInput): Promise<SendProposalShareEmailResult> {
  const resend = getResendClient();
  if (!resend) {
    return { ok: false, emailed: [], error: "Email delivery is not configured for this environment." };
  }

  const recipients = input.recipients.filter((recipient) => recipient.email);
  if (recipients.length === 0) {
    return { ok: false, emailed: [], error: "This revision has no client contact with an email address on file." };
  }

  const emailed: string[] = [];
  for (const recipient of recipients) {
    const { error } = await resend.emails.send({
      from: NOTIFICATION_FROM,
      to: recipient.email,
      subject: input.proposalNumber ? `${input.proposalNumber} — ${input.title}` : input.title,
      react: ProposalShareEmail({
        recipientName: recipient.name,
        title: input.title,
        proposalNumber: input.proposalNumber,
        url: input.url,
        expiresAt: input.expiresAt,
      }),
    });
    if (!error) emailed.push(recipient.email);
  }

  if (emailed.length === 0) {
    return { ok: false, emailed: [], error: "The email could not be delivered to any client contact." };
  }
  return { ok: true, emailed };
}
