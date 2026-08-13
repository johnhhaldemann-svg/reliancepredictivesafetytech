import "server-only";

// What the platform already knows about a client, assembled for an AI prompt.
//
// The document builder and legal research both start from blank forms: industry,
// jurisdiction and company standards are retyped on every run, and neither
// module carries a client_id at all. Meanwhile the platform holds the client's
// profile, the proposals written for them, the documents filed against them, and
// the legal register items and prior research that apply to them. Every
// engagement re-enters facts the system could have supplied, and output quality
// is capped by whatever someone remembered to paste.
//
// Modelled on lib/ai/command-context.ts, which does the same aggregation for the
// AI command assistant. Read-only: this module never writes, and callers treat a
// missing context as "carry on with what the form said".

import { createAdminClient } from "@/lib/supabase/admin";

/** Same convention as the rest of the AI modules (see command-context.ts). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LooseClient = any;

export interface ClientContextProposal {
  title: string;
  status: string;
  value: number | null;
  acceptedAt: string | null;
}

export interface ClientContext {
  clientId: string;
  name: string;
  industry: string | null;
  /** Where the client operates — the jurisdiction a document must satisfy. */
  state: string | null;
  lifecycleStage: string | null;
  /** Most recent proposals, newest first. */
  proposals: ClientContextProposal[];
  /** Titles of documents already filed for this client. */
  filedDocumentTitles: string[];
  /** Legal register items that apply to them. */
  legalTopics: string[];
}

const PROPOSAL_LIMIT = 5;
const DOCUMENT_LIMIT = 8;
const LEGAL_LIMIT = 8;

/**
 * Assembles the context for one client, or null when there is nothing useful to
 * say. Never throws: an AI feature that cannot enrich its prompt must still run
 * on what the user typed.
 */
export async function getClientContext(clientId: string | null | undefined): Promise<ClientContext | null> {
  if (!clientId || typeof clientId !== "string") return null;

  try {
    const db: LooseClient | null = createAdminClient();
    if (!db) return null;

    const { data: client } = await db
      .from("company_clients")
      .select("id, name, company_type, state, lifecycle_stage")
      .eq("id", clientId)
      .maybeSingle();
    if (!client) return null;

    const [{ data: proposals }, { data: documents }, { data: legalItems }] = await Promise.all([
      db
        .from("client_proposals")
        .select("title, status, proposal_value, accepted_at, updated_at")
        .eq("client_id", clientId)
        .order("updated_at", { ascending: false })
        .limit(PROPOSAL_LIMIT),
      db
        .from("company_documents")
        .select("title")
        .eq("client_id", clientId)
        .order("updated_at", { ascending: false })
        .limit(DOCUMENT_LIMIT),
      db
        .from("company_legal_issues")
        .select("title")
        .eq("client_id", clientId)
        .order("updated_at", { ascending: false })
        .limit(LEGAL_LIMIT),
    ]);

    return {
      clientId,
      name: (client.name as string) || "Client",
      industry: (client.company_type as string | null) ?? null,
      state: (client.state as string | null) ?? null,
      lifecycleStage: (client.lifecycle_stage as string | null) ?? null,
      proposals: (proposals ?? []).map((row: Record<string, unknown>) => ({
        title: (row.title as string) || "Proposal",
        status: (row.status as string) || "draft",
        value: row.proposal_value === null || row.proposal_value === undefined ? null : Number(row.proposal_value),
        acceptedAt: (row.accepted_at as string | null) ?? null,
      })),
      filedDocumentTitles: (documents ?? [])
        .map((row: Record<string, unknown>) => (row.title as string) ?? "")
        .filter(Boolean),
      legalTopics: (legalItems ?? [])
        .map((row: Record<string, unknown>) => (row.title as string) ?? "")
        .filter(Boolean),
    };
  } catch {
    return null;
  }
}
