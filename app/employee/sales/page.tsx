import { SalesPipelineManager } from "@/components/SalesPipelineManager";
import type { CompanyClient } from "@/lib/company-data";
import { removedClientStatus } from "@/lib/clients/removal";
import { createClient } from "@/lib/supabase/server";

export default async function SalesPipelinePage() {
  const supabase = await createClient();
  const [{ data: clients }, { data: demoRequests }] = supabase
    ? await Promise.all([
        // Companies removed from the lifecycle drop off the board. Filtered in
        // the query rather than in the component, so they are also absent from
        // the pipeline metrics above the columns — a removed deal that still
        // counted as an "active pursuit" would be worse than showing the card.
        supabase
          .from("company_clients")
          .select("*")
          .not("status", "ilike", removedClientStatus)
          .order("updated_at", { ascending: false }),
        supabase.from("demo_requests").select("*").neq("status", "converted").order("created_at", { ascending: false }),
      ])
    : [{ data: null }, { data: null }];

  return (
    <>
      <div className="portal-topline">
        <div>
          <div className="eyebrow">Sales Pipeline</div>
          <h1>First pitch to active company</h1>
          <p>Move prospects from lead and demo request through proposal, legal, onboarding, setup, and active status.</p>
        </div>
      </div>
      <SalesPipelineManager demoRequests={(demoRequests ?? []).map(r => ({ ...r, status: r.status ?? "", created_at: r.created_at ?? "" }))} initialClients={(clients ?? []) as CompanyClient[]} />
    </>
  );
}
