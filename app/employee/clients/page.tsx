import Link from "next/link";
import { ArrowRight, Building2 } from "lucide-react";
import { lifecycleStages } from "@/lib/company-data";
import {
  buildClientSearchFilter,
  buildDirectoryHref,
  hasActiveFilters,
  pageSize,
  resolvePage,
  resolveStageFilter,
  sanitizeSearch,
  type DirectorySearchParams,
} from "@/lib/clients/directory";
import { isRemovedClient, removedClientStatus, resolveClientRemovalFlags, resolveIncludeRemoved } from "@/lib/clients/removal";
import { ClientRemovalControl } from "@/components/clients/ClientRemovalControl";
import { getSessionContext } from "@/lib/supabase/server";

/**
 * The company directory.
 *
 * Every company at every lifecycle stage, searchable by name. This is the front
 * door to the client record: Active Companies only lists the last two stages,
 * and the pipeline board is a twelve-column kanban with no search, so before
 * this page existed a live deal could only be reached by visually scanning the
 * whole book of business.
 *
 * Covered by the existing `active_companies` module key, which already maps
 * /employee/clients (lib/user-management.ts). Deliberately NOT a new module key:
 * a new key would have to be granted per user, so everyone who can reach the
 * client record today would lose this page.
 */

/** Bounds the owner dropdown; owners past the cap are still reachable via search. */
const ownerSampleLimit = 500;

interface DirectoryRow {
  id: string;
  name: string;
  contact_name: string | null;
  email: string | null;
  lifecycle_stage: string;
  owner: string | null;
  status: string | null;
  updated_at: string;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default async function ClientsDirectoryPage({
  searchParams,
}: {
  searchParams: Promise<DirectorySearchParams>;
}) {
  const params = await searchParams;
  // Shares the request-memoized session lookup with the layout, and carries the
  // role the Remove control needs, so this is one round trip rather than two.
  const session = await getSessionContext();
  const supabase = session.supabase;
  const removalFlags = resolveClientRemovalFlags(session.role, session.isActive);

  // Filters are read from the URL and applied in the DATABASE query, so this
  // stays a server component and nothing becomes a client-side Supabase read
  // (CLAUDE.md, architectural conventions).
  const search = sanitizeSearch(params.q);
  const stage = resolveStageFilter(params.stage);
  const owner = (params.owner ?? "").trim();
  const includeRemoved = resolveIncludeRemoved(params.removed);
  const page = resolvePage(params.page);
  const rangeStart = (page - 1) * pageSize;

  let rows: DirectoryRow[] = [];
  let owners: string[] = [];
  let totalCount = 0;

  if (supabase) {
    let query = supabase
      .from("company_clients")
      .select("id, name, contact_name, email, lifecycle_stage, owner, status, updated_at", { count: "exact" })
      .order("updated_at", { ascending: false })
      .range(rangeStart, rangeStart + pageSize - 1);

    if (stage) query = query.eq("lifecycle_stage", stage);
    if (owner) query = query.eq("owner", owner);
    // Removed companies are excluded in the DATABASE query, not filtered out of
    // the page after the fact — otherwise the count, the paging and the "50 per
    // page" window would all still be counting rows nobody can see.
    //
    // `not.ilike` rather than `neq` so this agrees with `isRemovedClient`, which
    // matches case-insensitively because `status` is a free-text column the
    // company profile form writes through a plain text input. Safe against NULL
    // (which `not.ilike` would filter out) because the column is `not null`.
    if (!includeRemoved) query = query.not("status", "ilike", removedClientStatus);
    // Quoted and escaped in buildClientSearchFilter — a raw term here would be
    // PostgREST filter syntax, not data.
    if (search) query = query.or(buildClientSearchFilter(search));

    const [{ data, count }, { data: ownerRows }] = await Promise.all([
      query,
      supabase.from("company_clients").select("owner").not("owner", "is", null).limit(ownerSampleLimit),
    ]);

    rows = (data ?? []) as DirectoryRow[];
    totalCount = typeof count === "number" ? count : rows.length;
    owners = Array.from(
      new Set(((ownerRows ?? []) as { owner: string | null }[]).map((row) => row.owner).filter((value): value is string => Boolean(value?.trim()))),
    ).sort((a, b) => a.localeCompare(b));
  }

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const filtered = hasActiveFilters({ search, stage, owner });
  const showingFrom = totalCount === 0 ? 0 : rangeStart + 1;
  const showingTo = rangeStart + rows.length;

  return (
    <>
      <div className="portal-topline">
        <div>
          <div className="eyebrow">Commercial</div>
          <h1>Client Lifecycle</h1>
          <p>Every company at every stage, from first lead to renewal. Search by name, contact, email, or owner.</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span className="badge">
            {totalCount} {includeRemoved ? "total, removed included" : "on the lifecycle"}
          </span>
        </div>
      </div>

      <section>
        <form className="filters" method="get" action="/employee/clients">
          <div className="field">
            <label htmlFor="client-search">Search</label>
            <input
              id="client-search"
              name="q"
              defaultValue={search}
              placeholder="e.g. Ironline, Dana Reyes, dana@…"
            />
          </div>
          <div className="field">
            <label htmlFor="client-stage-filter">Stage</label>
            <select id="client-stage-filter" name="stage" defaultValue={stage}>
              <option value="">All stages</option>
              {lifecycleStages.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="client-owner-filter">Owner</label>
            <select id="client-owner-filter" name="owner" defaultValue={owner}>
              <option value="">All owners</option>
              {owners.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ alignSelf: "end" }}>
            <label htmlFor="client-show-removed" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {/* value="1" matches resolveIncludeRemoved: an unchecked box
                  submits nothing, which is what keeps removed companies hidden
                  by default. */}
              <input
                defaultChecked={includeRemoved}
                id="client-show-removed"
                name="removed"
                type="checkbox"
                value="1"
              />
              Show removed
            </label>
          </div>
          <div className="field" style={{ alignSelf: "end", display: "flex", gap: 8 }}>
            <button className="button button-primary" type="submit">
              Apply
            </button>
            {filtered ? (
              <Link className="button button-light" href={buildDirectoryHref({ removed: includeRemoved ? "1" : undefined })}>
                Clear
              </Link>
            ) : null}
          </div>
        </form>

        {rows.length === 0 ? (
          <div className="empty-state">
            {filtered ? (
              includeRemoved ? (
                "No companies match these filters."
              ) : (
                <>
                  No companies match these filters.{" "}
                  <Link href={buildDirectoryHref({ q: search, stage, owner, removed: "1" })}>
                    Include removed companies
                  </Link>{" "}
                  to check whether one was taken off the lifecycle.
                </>
              )
            ) : (
              <>
                No companies yet.{" "}
                <Link href="/employee/sales">Add the first one on the Sales Pipeline</Link> to start a deal.
              </>
            )}
          </div>
        ) : (
          <>
            <div className="data-table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Company</th>
                    <th>Stage</th>
                    <th>Contact</th>
                    <th>Owner</th>
                    <th>Updated</th>
                    <th>Actions</th>
                    <th>Lifecycle</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((client) => {
                    const recordHref = `/employee/clients/${client.id}`;
                    const removed = isRemovedClient(client.status);
                    return (
                      <tr key={client.id}>
                        <td>
                          <Link href={recordHref}>{client.name}</Link>
                          {removed ? (
                            <>
                              {" "}
                              <span className="badge">Removed</span>
                            </>
                          ) : null}
                        </td>
                        <td>{client.lifecycle_stage}</td>
                        <td>{client.contact_name ?? client.email ?? "—"}</td>
                        <td>{client.owner ?? "—"}</td>
                        <td>{formatDate(client.updated_at)}</td>
                        <td>
                          <Link
                            className="button button-light"
                            href={recordHref}
                            aria-label={`Open the record for ${client.name}`}
                          >
                            <Building2 size={14} /> Open record
                          </Link>
                        </td>
                        <td>
                          <ClientRemovalControl
                            allowed={removalFlags.canRemove}
                            clientId={client.id}
                            clientName={client.name}
                            removed={removed}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                flexWrap: "wrap",
                marginTop: 12,
              }}
            >
              <span className="muted">
                Showing {showingFrom}–{showingTo} of {totalCount}
              </span>
              {totalPages > 1 ? (
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {page > 1 ? (
                    <Link
                      className="button button-light"
                      href={buildDirectoryHref({
                        q: search,
                        stage,
                        owner,
                        page: String(page - 1),
                        removed: includeRemoved ? "1" : undefined,
                      })}
                    >
                      Previous
                    </Link>
                  ) : null}
                  <span className="muted">
                    Page {page} of {totalPages}
                  </span>
                  {page < totalPages ? (
                    <Link
                      className="button button-light"
                      href={buildDirectoryHref({
                        q: search,
                        stage,
                        owner,
                        page: String(page + 1),
                        removed: includeRemoved ? "1" : undefined,
                      })}
                    >
                      Next <ArrowRight size={14} />
                    </Link>
                  ) : null}
                </span>
              ) : null}
            </div>
          </>
        )}
      </section>
    </>
  );
}
