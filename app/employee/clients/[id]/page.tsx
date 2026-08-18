import Link from "next/link";
import { notFound } from "next/navigation";
import { ClientLifecycleStepper } from "@/components/clients/ClientLifecycleStepper";
import { ClientDetailManager } from "@/components/ClientDetailManager";
import {
  CompanyAddressAndContacts,
  type CompanyContactRow,
} from "@/components/clients/CompanyAddressAndContacts";
import type {
  ClientOnboardingItem,
  CompanyClient,
  CompanyDocument,
  CompanyDocumentRequirement,
  CompanyLegalIssue,
  CompanySalesActivity,
} from "@/lib/company-data";
import {
  ClientRelatedPanels,
  type ClientFileRow,
  type ClientTrainingEventRow,
} from "@/components/clients/ClientRelatedPanels";
import type { ClientMeetingRow, ClientProposalRow } from "@/lib/clients/related";
import {
  ProposalCreateForm,
  type ClientOption as ProposalClientOption,
} from "@/components/proposals/ProposalCreateForm";
import { ClientReceivablesPanel } from "@/components/clients/ClientReceivablesPanel";
import type { RevenueIncomeRow } from "@/lib/reports/revenue";
import { createClient } from "@/lib/supabase/server";

type ClientDetailPageProps = {
  params: Promise<{ id: string }>;
};

/** Same convention as lib/files/access.ts, for tables absent from the types. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LooseClient = any;

/** Bounds the code-uniqueness sample; mirrors the proposals list's own cap. */
const clientCodeSampleLimit = 500;

export default async function ClientDetailPage({ params }: ClientDetailPageProps) {
  const { id } = await params;
  const supabase = await createClient();
  if (!supabase) {
    notFound();
  }

  const { data: client } = await supabase.from("company_clients").select("*").eq("id", id).single();

  if (!client) {
    notFound();
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [
    { data: activities },
    { data: items },
    { data: documents },
    { data: legalIssues },
    { data: requirements },
    { data: masterTemplates },
    { data: contacts },
    { data: proposals },
    { data: files, count: fileCount },
    { data: meetings },
    { data: trainingEvents },
    { data: clientOptions },
    { data: financeAuthorization },
    { data: incomeRows },
  ] = await Promise.all([
      supabase.from("company_sales_activities").select("*").eq("client_id", id).order("created_at", { ascending: false }),
      supabase.from("client_onboarding_items").select("*").eq("client_id", id).order("sort_order"),
      supabase.from("company_documents").select("*").eq("client_id", id).order("updated_at", { ascending: false }),
      supabase.from("company_legal_issues").select("*").eq("client_id", id).order("updated_at", { ascending: false }),
      supabase.from("company_document_requirements").select("*").order("sort_order"),
      supabase.from("company_documents").select("*").eq("record_type", "Master Template").order("updated_at", { ascending: false }),
      // Primary first, then the record's own ordering — the same order the
      // proposal editor's picker shows them in.
      supabase
        .from("company_client_contacts")
        .select("id, name, title, email, phone, notes, is_primary")
        .eq("client_id", id)
        .order("is_primary", { ascending: false })
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true }),
      // The four families that already key on client_id and had no home on this
      // page. All read-only; each row links back to the module that owns it.
      supabase
        .from("client_proposals")
        .select("id, title, proposal_number, status, proposal_value, accepted_at, updated_at")
        .eq("client_id", id)
        .order("updated_at", { ascending: false })
        .limit(10),
      // company_files postdates the last Supabase types regen, so it is reached
      // through an untyped handle — the same convention lib/files/access.ts
      // already uses for the whole File Center module.
      (supabase as LooseClient)
        .from("company_files")
        .select("id, name, created_at", { count: "exact" })
        .eq("client_id", id)
        .is("archived_at", null)
        .order("created_at", { ascending: false })
        .limit(8),
      supabase
        .from("sales_video_meetings")
        .select("id, title, status, scheduled_at")
        .eq("client_id", id)
        .order("scheduled_at", { ascending: false })
        .limit(10),
      supabase
        .from("client_training_events")
        .select("id, title, status, scheduled_start_at, delivery_mode")
        .eq("client_id", id)
        .order("scheduled_start_at", { ascending: false })
        .limit(6),
      // Every company's code, not just this one's: writing the first proposal
      // for a company assigns its code, and the suggestion has to know which
      // codes are already taken to avoid proposing a duplicate.
      supabase.from("company_clients").select("id, name, client_code").order("name").limit(clientCodeSampleLimit),
      // Whether THIS viewer can see finance at all. Needed explicitly because
      // RLS returns zero rows rather than an error to an unauthorized reader,
      // and "no receivables" must not be shown for "you cannot see them".
      user
        ? supabase.from("company_finance_authorized_users").select("user_id").eq("user_id", user.id).maybeSingle()
        : Promise.resolve({ data: null }),
      // The schedule acceptance filed, reached through the proposal it sold.
      // !inner makes the join a filter, so this returns only rows belonging to
      // a proposal for THIS company.
      supabase
        .from("company_finance_transactions")
        .select("amount, status, transaction_date, proposal:client_proposals!inner(client_id)")
        .eq("transaction_type", "income")
        .eq("proposal.client_id", id),
    ]);

  return (
    <>
      <div className="portal-topline">
        <div>
          <div className="eyebrow">Client Record</div>
          <h1>{client.name}</h1>
          <p>{client.lifecycle_stage} - {client.contact_name ?? "No contact"} - {client.email ?? "No email"}</p>
        </div>
        <Link className="button button-light" href="/employee/sales">
          Back to pipeline
        </Link>
      </div>
      {/* Where this deal actually is, above everything else. The record held
          the whole lifecycle already, but the stage was one grey word in the
          subtitle and the work sat five screens down. */}
      <ClientLifecycleStepper
        currentStage={(client.lifecycle_stage ?? null) as string | null}
        items={(items ?? []) as ClientOnboardingItem[]}
      />

      {/* Above the rest of the record: this is what every proposal for this
          company pulls its Prepared For block from, and it was the one thing
          the company record could not hold. */}
      <CompanyAddressAndContacts
        clientId={id}
        clientName={(client.name ?? "") as string}
        clientCode={(client.client_code ?? null) as string | null}
        address={{
          address_line1: (client.address_line1 ?? null) as string | null,
          address_line2: (client.address_line2 ?? null) as string | null,
          city: (client.city ?? null) as string | null,
          state: (client.state ?? null) as string | null,
          postal_code: (client.postal_code ?? null) as string | null,
          country: (client.country ?? null) as string | null,
          website: (client.website ?? null) as string | null,
        }}
        contacts={(contacts ?? []) as CompanyContactRow[]}
      />

      <ClientDetailManager
        activities={(activities ?? []) as CompanySalesActivity[]}
        client={client as CompanyClient}
        documents={(documents ?? []) as CompanyDocument[]}
        legalIssues={(legalIssues ?? []) as CompanyLegalIssue[]}
        masterTemplates={(masterTemplates ?? []) as CompanyDocument[]}
        onboardingItems={(items ?? []) as ClientOnboardingItem[]}
        requirements={(requirements ?? []) as CompanyDocumentRequirement[]}
      />

      <ClientReceivablesPanel
        canSeeFinance={Boolean(financeAuthorization)}
        income={(incomeRows ?? []) as unknown as RevenueIncomeRow[]}
        now={new Date()}
      />

      <ClientRelatedPanels
        clientId={client.id}
        files={(files ?? []) as ClientFileRow[]}
        fileCount={fileCount ?? 0}
        meetings={(meetings ?? []) as ClientMeetingRow[]}
        now={new Date()}
        proposals={(proposals ?? []) as ClientProposalRow[]}
        trainingEvents={(trainingEvents ?? []) as ClientTrainingEventRow[]}
      />

      {/* Writing a proposal was the one thing this record pointed at another
          module to do. Bound to this company, so the proposal cannot be opened
          here and written against a different one. */}
      <div id="new-proposal" style={{ marginTop: 20 }}>
        <ProposalCreateForm
          clients={(clientOptions ?? []) as ProposalClientOption[]}
          lockedClientId={client.id as string}
        />
      </div>
    </>
  );
}
