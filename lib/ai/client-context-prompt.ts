// Turns a ClientContext into prompt text, and fills the gaps a blank form left.
//
// Pure so both behaviours are testable without a database: what the model is
// told about the client, and which form fields the context is allowed to
// supply when the user left them empty.

import type { ClientContext } from "./client-context";

/**
 * A short briefing block appended to a prompt.
 *
 * Deliberately compact: this rides along with every generation, and a long
 * recital of the client record would crowd out the actual request. Empty
 * sections are omitted rather than rendered as "none", which reads to a model
 * as a meaningful negative.
 */
export function renderClientContextBlock(context: ClientContext | null | undefined): string {
  if (!context) return "";

  const lines: string[] = [];
  const add = (label: string, value: string | null | undefined) => {
    if (!value || !String(value).trim()) return;
    lines.push(`- ${label}: ${value}`);
  };

  add("Client", context.name);
  add("Industry", context.industry);
  add("Operating state / jurisdiction", context.state);
  add("Relationship stage", context.lifecycleStage);

  const accepted = context.proposals.filter((proposal) => proposal.status === "accepted");
  if (accepted.length > 0) {
    add("Work already sold to them", accepted.map((proposal) => proposal.title).join("; "));
  }

  if (context.filedDocumentTitles.length > 0) {
    add("Documents already on file", context.filedDocumentTitles.join("; "));
  }

  if (context.legalTopics.length > 0) {
    add("Open legal / compliance topics", context.legalTopics.join("; "));
  }

  if (lines.length === 0) return "";

  return `CLIENT CONTEXT (from the platform's own records — prefer these facts over assumptions):\n${lines.join("\n")}`;
}

export interface ClientDefaultableFields {
  industry?: string;
  jurisdiction?: string;
}

/**
 * Fills industry and jurisdiction from the client record when the user left
 * them blank.
 *
 * Never overwrites something typed: the person filling the form may be drafting
 * for a site in a different state from the client's head office, and the value
 * in front of them must win.
 */
export function applyClientDefaults<T extends ClientDefaultableFields>(
  input: T,
  context: ClientContext | null | undefined,
): T {
  if (!context) return input;

  const filled: T = { ...input };
  const isBlank = (value: string | undefined) => !value || !value.trim();

  if (isBlank(filled.industry) && context.industry) {
    filled.industry = context.industry;
  }
  if (isBlank(filled.jurisdiction) && context.state) {
    filled.jurisdiction = context.state;
  }

  return filled;
}
