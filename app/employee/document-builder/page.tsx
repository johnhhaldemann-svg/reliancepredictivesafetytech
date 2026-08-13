import Link from "next/link";
import { getDocumentAccess } from "@/lib/documents/access";
import { DocumentBuilderForm } from "@/components/document-builder/DocumentBuilderForm";
import { ReviewStatusBadge, ConfidenceBadge } from "@/components/legal-register/badges";
import { docTypeLabels, type DocType } from "@/lib/documents/types";

interface DraftRow {
  id: string;
  doc_type: DocType;
  title: string;
  review_status: string;
  confidence_level: string | null;
  company_document_id: string | null;
  created_at: string;
}

export default async function DocumentBuilderPage() {
  const { supabase } = await getDocumentAccess();
  const [{ data: drafts }, { data: clients }] = supabase
    ? await Promise.all([
        supabase
          .from("document_builder_drafts")
          .select("id, doc_type, title, review_status, confidence_level, company_document_id, created_at")
          .order("created_at", { ascending: false })
          .limit(100),
        supabase.from("company_clients").select("id, name").order("name"),
      ])
    : [{ data: null }, { data: null }];

  const rows = (drafts ?? []) as DraftRow[];
  const clientOptions = ((clients ?? []) as Array<{ id: string; name: string }>).map((client) => ({
    id: client.id,
    name: client.name,
  }));

  return (
    <>
      <div className="portal-topline">
        <div>
          <div className="eyebrow">AI Document Builder</div>
          <h1>Draft, review, and publish safety documents</h1>
          <p>Generate SOPs and Policies with AI, review them, then publish to the Master Document Library as PDF + Word.</p>
        </div>
      </div>

      <div className="document-grid">
        <DocumentBuilderForm clients={clientOptions} />

        <section>
          <h2 style={{ marginBottom: 12 }}>Drafts</h2>
          {rows.length === 0 ? (
            <div className="empty-state">No drafts yet. Generate one to get started.</div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Confidence</th>
                  <th>Published</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => (
                  <tr key={d.id}>
                    <td>
                      <Link href={`/employee/document-builder/${d.id}`}>{d.title}</Link>
                    </td>
                    <td>{docTypeLabels[d.doc_type] ?? d.doc_type}</td>
                    <td><ReviewStatusBadge status={d.review_status} /></td>
                    <td><ConfidenceBadge level={d.confidence_level} /></td>
                    <td>{d.company_document_id ? "Yes" : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </>
  );
}
