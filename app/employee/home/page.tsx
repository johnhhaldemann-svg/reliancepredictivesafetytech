import Link from "next/link";
import { redirect } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  BriefcaseBusiness,
  Bot,
  Building2,
  FileSignature,
  Inbox,
  ReceiptText,
  ScrollText,
} from "lucide-react";
import { getCommandSnapshot, type CommandPriorityItem } from "@/lib/ai/command-context";
import { lifecycleStages } from "@/lib/company-data";
import { createClient } from "@/lib/supabase/server";
import { canAccessEmployeePath, hasFullPortalVisibility, isPortalOwnerRole } from "@/lib/user-management";
import { DashboardSwitch } from "@/components/dashboard/DashboardSwitch";
import {
  collapseQueue,
  countByWorkspace,
  countQueueByFilter,
  filterQueue,
  parseQueueFilter,
  pickHeadline,
  queueFilters,
  type QueueFilter,
} from "@/lib/dashboard/queue";

/**
 * The Focus dashboard.
 *
 * The classic dashboard answers "what does this platform contain". This one
 * answers "what should I do next", which is a different question and needs a
 * different screen. It lives at its own route beside the original rather than
 * replacing it, and a person moves between the two with the switch in the
 * header. Nothing here writes; it is a read of the same command snapshot the
 * AI Command Center already uses.
 */

const filterLabels: Record<QueueFilter, string> = {
  all: "All",
  mine: "Mine",
  review: "To review",
  risk: "At risk",
};

const priorityTone: Record<string, string> = {
  critical: "focus-dot-critical",
  high: "focus-dot-high",
  medium: "focus-dot-medium",
  low: "focus-dot-low",
};

function greeting(now: Date) {
  const hour = now.getHours();

  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";

  return "Good evening";
}

function formatDay(now: Date) {
  return now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

function daysLate(dueDate: string | null, now: Date) {
  if (!dueDate) return null;

  const due = new Date(`${dueDate.slice(0, 10)}T23:59:59.999Z`);
  if (!Number.isFinite(due.getTime()) || due.getTime() >= now.getTime()) return null;

  return Math.floor((now.getTime() - due.getTime()) / 86_400_000) + 1;
}

function agePill(item: CommandPriorityItem, now: Date) {
  const late = daysLate(item.dueDate, now);

  if (late !== null) {
    return { tone: "focus-pill-danger", text: `${late} day${late === 1 ? "" : "s"} late` };
  }

  if (item.reviewRequired) {
    return { tone: "focus-pill-warning", text: "To review" };
  }

  if (item.priority === "critical" || item.priority === "high") {
    return { tone: "focus-pill-warning", text: "At risk" };
  }

  return { tone: "focus-pill-muted", text: item.status || "Open" };
}

export default async function FocusDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  // No cookie read here on purpose. This route does not bounce a visitor whose
  // preference is classic — it is a nav destination in its own right, so anyone
  // can look at the Focus dashboard without committing to it. The tab strip
  // marks where you ARE, not what you last chose, and the preference is written
  // only when a tab is pressed.

  const { q } = await searchParams;
  const activeFilter = parseQueueFilter(q);
  const now = new Date();

  const supabase = await createClient();
  const {
    data: { user },
  } = supabase ? await supabase.auth.getUser() : { data: { user: null } };

  if (supabase && !user) {
    redirect("/employee-login?next=/employee/home");
  }

  const { data: currentRole } =
    supabase && user
      ? await supabase.from("user_roles").select("role, account_status").eq("user_id", user.id).maybeSingle()
      : { data: null };

  const [{ data: financeAuthorization }, { data: moduleAccess }, { data: profile }] =
    supabase && user
      ? await Promise.all([
          supabase.from("company_finance_authorized_users").select("user_id").eq("user_id", user.id).maybeSingle(),
          hasFullPortalVisibility(currentRole?.role, currentRole?.account_status)
            ? Promise.resolve({ data: [] })
            : supabase.from("portal_user_module_access").select("module_key").eq("user_id", user.id),
          supabase.from("employee_profiles").select("display_name, legal_name").eq("user_id", user.id).maybeSingle(),
        ])
      : [{ data: null }, { data: [] }, { data: null }];

  const moduleKeys = (moduleAccess ?? []).map((access) => access.module_key);
  const canViewFinanceModule = canAccessEmployeePath(
    currentRole?.role,
    currentRole?.account_status,
    "/employee/finance",
    moduleKeys,
  );
  const canAccessFinance = Boolean(
    currentRole?.account_status === "active" &&
      canViewFinanceModule &&
      (isPortalOwnerRole(currentRole.role) || financeAuthorization),
  );

  const snapshot =
    supabase && user
      ? await getCommandSnapshot(supabase, user.id)
      : { counts: null, priorityItems: [] as CommandPriorityItem[], generatedAt: "", summary: "" };

  const { data: clientStages } = supabase
    ? await supabase.from("company_clients").select("lifecycle_stage")
    : { data: null };

  const stageCounts = new Map<string, number>();
  (clientStages ?? []).forEach((row) => {
    const stage = String(row.lifecycle_stage ?? "");
    stageCounts.set(stage, (stageCounts.get(stage) ?? 0) + 1);
  });

  const totalClients = (clientStages ?? []).length;
  // display_name is what a person is called; legal_name is the fallback the
  // HR record always carries. Owner strings in the snapshot are display names.
  const viewerName = (profile?.display_name as string | null) ?? (profile?.legal_name as string | null) ?? null;
  const items = snapshot.priorityItems ?? [];
  const counts = countQueueByFilter(items, viewerName, now);
  const visible = filterQueue(items, activeFilter, viewerName, now);
  const groups = collapseQueue(visible);
  const headline = pickHeadline(items);
  const byWorkspace = countByWorkspace(items);

  const dealPath = [
    { n: "01", label: "Requests", href: "/employee/inbox", detail: `${snapshot.counts?.newDemoRequests ?? 0} new`, icon: Inbox },
    { n: "02", label: "Pipeline", href: "/employee/sales", detail: `${totalClients} companies`, icon: BriefcaseBusiness },
    { n: "03", label: "Client Lifecycle", href: "/employee/clients", detail: "Every stage", icon: Building2 },
    { n: "04", label: "Proposals", href: "/employee/proposals", detail: `${snapshot.counts?.proposalsAwaitingReview ?? 0} in review`, icon: ScrollText },
    { n: "05", label: "Contracts", href: "/employee/documents", detail: "Signature status", icon: FileSignature },
    { n: "06", label: "Money", href: canAccessFinance ? "/employee/finance" : "/employee/reports", detail: canAccessFinance ? "Cash movement" : "Reports", icon: ReceiptText },
  ];

  const pulse = [
    { value: totalClients, label: "Companies in play", tone: "" },
    { value: snapshot.counts?.proposalsAwaitingReview ?? 0, label: "Awaiting your approval", tone: (snapshot.counts?.proposalsAwaitingReview ?? 0) > 0 ? "focus-tile-alert" : "" },
    { value: snapshot.counts?.pendingWorkflowProposals ?? 0, label: "AI items to review", tone: "" },
    { value: snapshot.counts?.stateComplianceReviews ?? 0, label: "State reviews queued", tone: "" },
  ];

  return (
    <>
      <div className="portal-topline focus-topline">
        <div>
          <div className="eyebrow">{formatDay(now)}</div>
          <h1>
            {greeting(now)}
            {viewerName ? `, ${viewerName.split(" ")[0]}` : ""}
          </h1>
          <p>
            {counts.all === 0
              ? "Nothing is waiting on you. The queue is clear."
              : `${counts.all} thing${counts.all === 1 ? "" : "s"} need attention. The one below moves money or blocks work.`}
          </p>
        </div>
        <DashboardSwitch current="focus" />
      </div>

      {headline ? (
        <section className="focus-headline">
          <div className="eyebrow">Do this first</div>
          <h2>{headline.title}</h2>
          <p>
            {headline.sourceLabel} - {headline.detail}
          </p>
          <div className="focus-headline-actions">
            <Link className="button focus-btn-gold" href={headline.actionHref || headline.href}>
              Open it <ArrowRight size={15} />
            </Link>
            <Link className="button button-light" href={headline.href}>
              See the record
            </Link>
          </div>
        </section>
      ) : null}

      <div className="focus-pulse">
        {pulse.map((tile) => (
          <div className={`focus-tile ${tile.tone}`} key={tile.label}>
            <div className="focus-tile-value">{tile.value}</div>
            <div className="focus-tile-label">{tile.label}</div>
          </div>
        ))}
      </div>

      <section className="table-card focus-block">
        <div className="checklist-section">
          <div className="stage-workspace-head">
            <div>
              <span className="eyebrow">Lead to cash</span>
              <h2>One path, six modules</h2>
            </div>
          </div>
          <div className="focus-path">
            {dealPath.map((step) => (
              <Link className="focus-path-step" href={step.href} key={step.n}>
                <span className="focus-path-n">{step.n}</span>
                <span className="focus-path-label">{step.label}</span>
                <span className="focus-path-detail">{step.detail}</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <div className="focus-columns">
        <section className="table-card">
          <div className="stage-workspace-head focus-queue-head">
            <div>
              <span className="eyebrow">Priority queue</span>
              <h2>Everything, counted once</h2>
            </div>
            <div className="focus-filters">
              {queueFilters.map((filter) => (
                <Link
                  className={`focus-filter${filter === activeFilter ? " is-active" : ""}`}
                  href={filter === "all" ? "/employee/home" : `/employee/home?q=${filter}`}
                  key={filter}
                >
                  {filterLabels[filter]} <span className="focus-filter-count">{counts[filter]}</span>
                </Link>
              ))}
            </div>
          </div>

          <div className="focus-queue">
            {groups.length === 0 ? (
              <div className="empty-state">Nothing in this filter.</div>
            ) : (
              groups.map((group) => {
                const pill = agePill(group.lead, now);

                return (
                  <Link className="focus-row" href={group.lead.actionHref || group.lead.href} key={group.key}>
                    <span className={`focus-dot ${priorityTone[group.lead.priority] ?? "focus-dot-low"}`} />
                    <span className="focus-row-body">
                      <span className="focus-row-title">
                        {group.count > 1 ? `${group.lead.label} - ${group.count} items` : group.lead.title}
                      </span>
                      <span className="focus-row-detail">
                        {group.count > 1
                          ? `${group.lead.sourceLabel} - including ${group.lead.title}`
                          : `${group.lead.sourceLabel} - ${group.lead.detail}`}
                      </span>
                    </span>
                    <span className={`focus-pill ${pill.tone}`}>{pill.text}</span>
                  </Link>
                );
              })
            )}
          </div>
        </section>

        <div className="focus-side">
          <section className="table-card">
            <div className="checklist-section">
              <span className="eyebrow">Across the platform</span>
              <h2 className="focus-side-h">Where the pressure is</h2>
              <div className="focus-workspaces">
                {byWorkspace.length === 0 ? (
                  <div className="empty-state">Nothing open anywhere.</div>
                ) : (
                  byWorkspace.map((row) => (
                    <div className="focus-workspace-row" key={row.workspace}>
                      <span>{row.workspace}</span>
                      <strong>{row.count}</strong>
                    </div>
                  ))
                )}
              </div>
            </div>
          </section>

          <section className="table-card focus-block">
            <div className="checklist-section">
              <span className="eyebrow">Assistant</span>
              <h2 className="focus-side-h">AI Command Center</h2>
              <div className="focus-ai-value">{snapshot.counts?.pendingWorkflowProposals ?? 0}</div>
              <p className="focus-ai-note">
                Waiting on a human. Nothing an agent proposes touches a record until someone approves it.
              </p>
              <Link className="button button-light focus-ai-button" href="/employee/ai">
                <Bot size={15} /> Open AI Command
              </Link>
            </div>
          </section>

          <section className="table-card focus-block">
            <div className="checklist-section">
              <span className="eyebrow">Pipeline</span>
              <h2 className="focus-side-h">All twelve stages</h2>
              <div className="focus-stages">
                {lifecycleStages.map((stage) => (
                  <div className="focus-stage-row" key={stage}>
                    <span>{stage}</span>
                    <strong>{stageCounts.get(stage) ?? 0}</strong>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>
      </div>

      <p className="focus-foot">
        <AlertTriangle size={13} /> This is the Focus dashboard. Use the switch at the top to go back to the
        classic one at any time — your choice is remembered.
      </p>
    </>
  );
}
