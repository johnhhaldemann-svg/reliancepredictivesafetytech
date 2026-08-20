#!/usr/bin/env node
// Scaffolds a portal module that satisfies the MODULE SPECIFICATION CONTRACT.
//
// Every module in this platform needs the same eleven things, and the ones that
// get forgotten are always the same ones: the loading skeleton, the error
// boundary, the updated_at trigger, the self-attribution check on insert, and —
// the expensive one — widening portal_user_module_access_module_key_check so a
// super admin can actually grant the module. Three migrations in this repo
// exist solely to repair that last omission after the fact.
//
// This generator writes all of it from a spec, and regenerates the module_key
// constraint from the live catalog so it can never ship one key behind.
//
// Usage:
//   node scripts/generate-module.mjs --spec module.json [--root .] [--dry-run] [--force]
//
// Spec (JSON):
//   {
//     "moduleId": "safety_observations",          // snake_case; this is the module_key
//     "label": "Safety Observations",
//     "group": "Governance",                       // Command|Commercial|People|Governance|Admin|Platform
//     "pathPrefix": "/employee/observations",
//     "purpose": "Log and close field safety observations.",
//     "rolesAllowed": ["admin", "company_admin"],
//     "dataObjects": ["company_safety_observations"],
//     "workflowStates": ["open", "in_progress", "closed"],
//     "acceptanceCriteria": ["An employee can log an observation", "A closed observation keeps its history"]
//   }

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const PORTAL_GROUPS = ["Command", "Commercial", "People", "Governance", "Admin", "Platform"];

// ---------------------------------------------------------------------------
// spec validation — mirrors lib/guardrails/module-spec.ts
// ---------------------------------------------------------------------------

export function validateSpec(spec) {
  const errors = [];
  const push = (message) => errors.push(message);

  if (!spec || typeof spec !== "object") return { valid: false, errors: ["spec must be an object"] };

  if (!spec.moduleId || !/^[a-z][a-z0-9_]*$/.test(spec.moduleId)) {
    push("moduleId must be snake_case starting with a letter");
  }
  if (!spec.label || !String(spec.label).trim()) push("label is required");
  if (!spec.purpose || !String(spec.purpose).trim()) push("purpose is required");
  if (!PORTAL_GROUPS.includes(spec.group)) push(`group must be one of ${PORTAL_GROUPS.join(", ")}`);
  if (!spec.pathPrefix || !String(spec.pathPrefix).startsWith("/employee/")) {
    push("pathPrefix must start with /employee/");
  }
  if (!Array.isArray(spec.rolesAllowed) || spec.rolesAllowed.length === 0) {
    push("rolesAllowed must list at least one role");
  }
  if (!Array.isArray(spec.dataObjects) || spec.dataObjects.length === 0) {
    push("dataObjects must list at least one table");
  } else {
    for (const table of spec.dataObjects) {
      if (!/^[a-z][a-z0-9_]*$/.test(table)) push(`dataObject "${table}" must be a snake_case table name`);
    }
  }
  if (!Array.isArray(spec.acceptanceCriteria) || spec.acceptanceCriteria.length < 2) {
    push("acceptanceCriteria must have at least 2 criteria");
  }
  if (spec.group === "Platform" && spec.platformRolesOnly !== true) {
    push("Platform group modules must set platformRolesOnly: true");
  }
  if (spec.group === "Platform" && (spec.minimumTestScenarios ?? 0) < 5) {
    push("Platform group modules must have minimumTestScenarios >= 5");
  }

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// derivations
// ---------------------------------------------------------------------------

/** lib/<dir> and the app route both key off the last path segment. */
export function routeSegment(pathPrefix) {
  return pathPrefix.replace(/^\/employee\//, "").replace(/\/+$/, "");
}

export function pascalCase(value) {
  return String(value)
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join("");
}

/**
 * Every module_key already in the catalog, in catalog order. The constraint is
 * regenerated from this rather than amended, so a key that drifted in earlier
 * gets repaired by the next module anyone generates.
 */
export function readCatalogKeys(source) {
  const start = source.indexOf("portalModuleCatalog");
  if (start === -1) throw new Error("Could not find portalModuleCatalog in lib/user-management.ts");
  const end = source.indexOf("] as const", start);
  const block = source.slice(start, end === -1 ? undefined : end);
  return [...block.matchAll(/key:\s*"([a-z0-9_]+)"/g)].map((match) => match[1]);
}

/** UTC stamp matching the repo's migration filename convention. */
export function migrationStamp(now = new Date()) {
  const pad = (n, width = 2) => String(n).padStart(width, "0");
  return (
    `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}` +
    `${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`
  );
}

// ---------------------------------------------------------------------------
// templates
// ---------------------------------------------------------------------------

function pageTemplate(spec, ctx) {
  return `import { redirect } from "next/navigation";
import { get${ctx.Pascal}Access } from "@/lib/${ctx.segment}/access";
import { summarise${ctx.Pascal} } from "@/lib/${ctx.segment}/policy";

/**
 * ${spec.label}.
 *
 * ${spec.purpose}
 *
 * MODULE_ID: ${spec.moduleId}
 * ROLES_ALLOWED: ${spec.rolesAllowed.join(", ")}
 */
export default async function ${ctx.Pascal}Page() {
  const { supabase, isActive } = await get${ctx.Pascal}Access();
  if (!supabase) redirect("/employee-login");
  if (!isActive) redirect("/employee");

  const { data, error } = await supabase
    .from("${ctx.table}")
    .select("*")
    .order("created_at", { ascending: false });

  // An error here is a real failure, not an empty state — say so rather than
  // rendering "nothing yet" over a broken query.
  const rows = data ?? [];
  const summary = summarise${ctx.Pascal}(rows);

  return (
    <div className="page">
      <header className="page-header">
        <h1>${spec.label}</h1>
        <p style={{ color: "var(--portal-muted)" }}>${spec.purpose}</p>
      </header>

      {error ? <div className="error-box">Could not load ${spec.label.toLowerCase()}: {error.message}</div> : null}

      <section className="panel">
        <div className="stat-row">
          <div className="stat">
            <span className="stat-label">Total</span>
            <span className="stat-value">{summary.total}</span>
          </div>
${(spec.workflowStates ?? [])
  .map(
    (state) => `          <div className="stat">
            <span className="stat-label">${state.replace(/_/g, " ")}</span>
            <span className="stat-value">{summary.byState["${state}"] ?? 0}</span>
          </div>`,
  )
  .join("\n")}
        </div>
      </section>

      <section className="panel">
        {rows.length === 0 && !error ? (
          <p style={{ color: "var(--portal-muted)" }}>Nothing here yet.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Status</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row: { id: string; title: string | null; status: string | null; created_at: string }) => (
                <tr key={row.id}>
                  <td>{row.title ?? "Untitled"}</td>
                  <td>{row.status ?? "—"}</td>
                  <td>{new Date(row.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
`;
}

function loadingTemplate(spec) {
  return `/**
 * Server-rendered skeleton for ${spec.label}. Every /employee/* route ships one
 * so the shell paints before the data resolves.
 */
export default function Loading() {
  return (
    <div className="page">
      <header className="page-header">
        <h1>${spec.label}</h1>
      </header>
      <section className="panel">
        <div className="skeleton skeleton-row" />
        <div className="skeleton skeleton-row" />
        <div className="skeleton skeleton-row" />
      </section>
    </div>
  );
}
`;
}

function errorTemplate(spec, ctx) {
  return `"use client";

import { useEffect } from "react";

/**
 * Error boundary for ${spec.label}. Without one, a thrown error in this subtree
 * takes out the whole portal shell instead of this page.
 */
export default function ${ctx.Pascal}Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[${spec.moduleId}]", error);
  }, [error]);

  return (
    <div className="page">
      <header className="page-header">
        <h1>${spec.label}</h1>
      </header>
      <div className="error-box">
        <p>Something went wrong loading ${spec.label.toLowerCase()}.</p>
        {error.digest ? <p style={{ fontSize: "0.85rem" }}>Reference: {error.digest}</p> : null}
        <button className="button button-light" onClick={reset} type="button">
          Try again
        </button>
      </div>
    </div>
  );
}
`;
}

function accessTemplate(spec, ctx) {
  return `import "server-only";
import { createClient } from "@/lib/supabase/server";
import { resolve${ctx.Pascal}RoleFlags } from "./policy";

export interface ${ctx.Pascal}Access {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
  userId: string | null;
  role: string | null;
  isActive: boolean;
  isAdmin: boolean;
}

/**
 * Resolves the current user's ${spec.label} access. The role decision itself
 * lives in policy.ts so it can be unit-tested without a database.
 */
export async function get${ctx.Pascal}Access(): Promise<${ctx.Pascal}Access> {
  const supabase = await createClient();
  if (!supabase) {
    return { supabase: null, userId: null, role: null, isActive: false, isAdmin: false };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { supabase, userId: null, role: null, isActive: false, isAdmin: false };
  }

  const { data: roleRow } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id)
    .eq("account_status", "active")
    .maybeSingle();

  const role = roleRow?.role ?? null;
  const isActive = Boolean(roleRow);

  return { supabase, userId: user.id, role, isActive, ...resolve${ctx.Pascal}RoleFlags(role, isActive) };
}
`;
}

function policyTemplate(spec, ctx) {
  const states = spec.workflowStates ?? [];
  return `// Pure policy for ${spec.label}. No server-only import, no Supabase — every
// rule here is unit-tested directly in policy.test.ts.
//
// MODULE_ID: ${spec.moduleId}

export const ${ctx.camel}AdminRoles = ["super_admin", "platform_admin", "company_admin", "admin"] as const;

${
  states.length
    ? `export const ${ctx.camel}States = [${states.map((s) => `"${s}"`).join(", ")}] as const;
export type ${ctx.Pascal}State = (typeof ${ctx.camel}States)[number];

/**
 * Forward-only transitions. A state machine that allows a backward move is how
 * a closed record silently reopens with no audit trail.
 */
export function canTransition(from: string, to: string): boolean {
  const fromIndex = (${ctx.camel}States as readonly string[]).indexOf(from);
  const toIndex = (${ctx.camel}States as readonly string[]).indexOf(to);
  if (fromIndex === -1 || toIndex === -1) return false;
  return toIndex > fromIndex;
}
`
    : ""
}
/**
 * An inactive account has no access at all, whatever its role says — the role
 * row outlives the account, so status is checked first.
 */
export function resolve${ctx.Pascal}RoleFlags(role: string | null, isActive: boolean): { isAdmin: boolean } {
  if (!isActive || !role) return { isAdmin: false };
  return { isAdmin: (${ctx.camel}AdminRoles as readonly string[]).includes(role) };
}

export interface ${ctx.Pascal}Row {
  id: string;
  status?: string | null;
}

export interface ${ctx.Pascal}Summary {
  total: number;
  byState: Record<string, number>;
}

export function summarise${ctx.Pascal}(rows: readonly ${ctx.Pascal}Row[]): ${ctx.Pascal}Summary {
  const byState: Record<string, number> = {};
  for (const row of rows) {
    const key = row.status ?? "unknown";
    byState[key] = (byState[key] ?? 0) + 1;
  }
  return { total: rows.length, byState };
}
`;
}

function policyTestTemplate(spec, ctx) {
  const states = spec.workflowStates ?? [];
  return `import { describe, expect, it } from "vitest";
import { resolve${ctx.Pascal}RoleFlags, summarise${ctx.Pascal}${states.length ? ", canTransition" : ""} } from "./policy";

// Acceptance criteria from the module spec:
${spec.acceptanceCriteria.map((criterion) => `//   - ${criterion}`).join("\n")}

describe("resolve${ctx.Pascal}RoleFlags", () => {
  it("grants admin rights to an active admin", () => {
    expect(resolve${ctx.Pascal}RoleFlags("admin", true).isAdmin).toBe(true);
  });

  it("denies an archived admin, whose role row outlives the account", () => {
    expect(resolve${ctx.Pascal}RoleFlags("admin", false).isAdmin).toBe(false);
  });

  it("denies an active non-admin", () => {
    expect(resolve${ctx.Pascal}RoleFlags("employee", true).isAdmin).toBe(false);
  });

  it("denies a missing role", () => {
    expect(resolve${ctx.Pascal}RoleFlags(null, true).isAdmin).toBe(false);
  });
});

describe("summarise${ctx.Pascal}", () => {
  it("counts an empty set without inventing states", () => {
    expect(summarise${ctx.Pascal}([])).toEqual({ total: 0, byState: {} });
  });

  it("buckets rows by status and files a missing status under unknown", () => {
    const summary = summarise${ctx.Pascal}([
      { id: "1", status: "${states[0] ?? "open"}" },
      { id: "2", status: "${states[0] ?? "open"}" },
      { id: "3", status: null },
    ]);
    expect(summary.total).toBe(3);
    expect(summary.byState["${states[0] ?? "open"}"]).toBe(2);
    expect(summary.byState.unknown).toBe(1);
  });
});
${
  states.length >= 2
    ? `
describe("canTransition", () => {
  it("allows a forward move", () => {
    expect(canTransition("${states[0]}", "${states[1]}")).toBe(true);
  });

  it("refuses a backward move", () => {
    expect(canTransition("${states[1]}", "${states[0]}")).toBe(false);
  });

  it("refuses a move to the same state", () => {
    expect(canTransition("${states[0]}", "${states[0]}")).toBe(false);
  });

  it("refuses an unrecognised state on either side", () => {
    expect(canTransition("${states[0]}", "invented")).toBe(false);
    expect(canTransition("invented", "${states[0]}")).toBe(false);
  });
});
`
    : ""
}`;
}

function migrationTemplate(spec, ctx) {
  const keys = [...ctx.catalogKeys];
  if (!keys.includes(spec.moduleId)) keys.push(spec.moduleId);
  const keyList = keys.map((key) => `      '${key}'`).join(",\n");
  const states = spec.workflowStates ?? [];
  const statusColumn = states.length
    ? `  status       text not null default '${states[0]}'
                 check (status in (${states.map((s) => `'${s}'`).join(", ")})),`
    : "";

  return `-- ${spec.label} (${spec.group} group)
-- MODULE_ID: ${spec.moduleId} — ${spec.purpose}
--
-- TENANT MODEL: single-tenant internal portal, mirroring company_files and
--   client_proposals. Any active portal employee may read and create; edits are
--   employee-level; DELETE is admin-only because it is the destructive act.
--   Inserts must self-attribute so a row cannot be planted in a colleague's name.
--
-- The module_key check below is REGENERATED from the full lib/user-management.ts
-- catalog rather than amended. Three earlier migrations exist only to repair
-- keys that shipped in the catalog but never reached this constraint, which
-- leaves a super admin unable to grant the module. Regenerating makes that
-- class of drift self-healing.
--
-- ROLLBACK
${spec.dataObjects.map((table) => `--   drop table if exists public.${table} cascade;`).join("\n")}
--   delete from public.portal_user_module_access where module_key = '${spec.moduleId}';
--   -- then re-apply the module_key check from the previous migration that defines it
--   Safe at any time; nothing outside these objects is touched.

-- ============================================================================
-- 1. ${ctx.table}
-- ============================================================================
create table if not exists public.${ctx.table} (
  id           uuid primary key default gen_random_uuid(),
  title        text not null check (char_length(btrim(title)) between 1 and 200),
${statusColumn}
  notes        text check (notes is null or char_length(notes) <= 8000),
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.${ctx.table} is
  '${spec.purpose.replace(/'/g, "''")} Owned by the ${spec.moduleId} module.';

create index if not exists ${ctx.table}_created_at_idx
  on public.${ctx.table} (created_at desc);
${
  states.length
    ? `create index if not exists ${ctx.table}_status_idx
  on public.${ctx.table} (status);
`
    : ""
}
-- updated_at trigger (shared helper from 20260505000000_company_portal.sql)
drop trigger if exists set_${ctx.table}_updated_at on public.${ctx.table};
create trigger set_${ctx.table}_updated_at
before update on public.${ctx.table}
for each row execute function public.set_updated_at();

-- ============================================================================
-- 2. RLS
-- ============================================================================
alter table public.${ctx.table} enable row level security;

grant select, insert, update, delete on public.${ctx.table} to authenticated;

drop policy if exists "${ctx.table}_read_employee" on public.${ctx.table};
create policy "${ctx.table}_read_employee" on public.${ctx.table}
  for select to authenticated using (public.is_company_portal_employee());

drop policy if exists "${ctx.table}_insert_employee" on public.${ctx.table};
create policy "${ctx.table}_insert_employee" on public.${ctx.table}
  for insert to authenticated with check (
    public.is_company_portal_employee()
    and created_by = (select auth.uid())
  );

drop policy if exists "${ctx.table}_update_employee" on public.${ctx.table};
create policy "${ctx.table}_update_employee" on public.${ctx.table}
  for update to authenticated
  using (public.is_company_portal_employee())
  with check (public.is_company_portal_employee());

drop policy if exists "${ctx.table}_delete_admin" on public.${ctx.table};
create policy "${ctx.table}_delete_admin" on public.${ctx.table}
  for delete to authenticated using (public.is_company_portal_admin());

-- ============================================================================
-- 3. Module access — regenerate the constraint, then backfill grants
-- ============================================================================
alter table public.portal_user_module_access
  drop constraint if exists portal_user_module_access_module_key_check;

alter table public.portal_user_module_access
  add constraint portal_user_module_access_module_key_check
  check (
    module_key in (
${keyList}
    )
  );

-- Every active user gets the module, matching the whole-team read model above.
-- Owner roles bypass grants entirely; new users are covered by the app-side
-- default grant list.
insert into public.portal_user_module_access (user_id, module_key, granted_by)
select role_row.user_id, '${spec.moduleId}', null
from public.user_roles role_row
where role_row.account_status = 'active'
on conflict (user_id, module_key) do nothing;
`;
}

// ---------------------------------------------------------------------------
// generation
// ---------------------------------------------------------------------------

/** Builds every file the module needs. Pure: returns paths and contents, writes nothing. */
export function buildModuleFiles(spec, options = {}) {
  const { valid, errors } = validateSpec(spec);
  if (!valid) throw new Error(`Invalid module spec:\n  - ${errors.join("\n  - ")}`);

  const segment = routeSegment(spec.pathPrefix);
  const ctx = {
    segment,
    Pascal: pascalCase(segment),
    camel: (() => {
      const p = pascalCase(segment);
      return p[0].toLowerCase() + p.slice(1);
    })(),
    table: spec.dataObjects[0],
    catalogKeys: options.catalogKeys ?? [],
  };

  const appDir = `app/employee/${segment}`;
  const libDir = `lib/${segment}`;
  const stamp = options.stamp ?? migrationStamp(options.now);

  return [
    { path: `${appDir}/page.tsx`, contents: pageTemplate(spec, ctx) },
    { path: `${appDir}/loading.tsx`, contents: loadingTemplate(spec) },
    { path: `${appDir}/error.tsx`, contents: errorTemplate(spec, ctx) },
    { path: `${libDir}/access.ts`, contents: accessTemplate(spec, ctx) },
    { path: `${libDir}/policy.ts`, contents: policyTemplate(spec, ctx) },
    { path: `${libDir}/policy.test.ts`, contents: policyTestTemplate(spec, ctx) },
    {
      path: `supabase/migrations/${stamp}_${spec.moduleId}.sql`,
      contents: migrationTemplate(spec, ctx),
    },
  ];
}

/** The two edits a generator should not make blindly, printed for a human to apply. */
export function wiringInstructions(spec) {
  const segment = routeSegment(spec.pathPrefix);
  return [
    "Wire it up — two one-line edits, both deliberate:",
    "",
    "1. lib/user-management.ts → portalModuleCatalog, in the " + spec.group + " block:",
    `     { key: "${spec.moduleId}", label: "${spec.label}", group: "${spec.group}", pathPrefixes: ["${spec.pathPrefix}"] },`,
    "",
    "2. components/EmployeeSidebar.tsx → the " + spec.group + " group's items:",
    `     { href: "${spec.pathPrefix}", label: "${spec.label}", icon: FileText },`,
    "",
    "   (pick a lucide icon that is not already in use and add it to the import)",
    "",
    "Then:",
    "   npm run typecheck && npm test",
    `   review supabase/migrations/*_${spec.moduleId}.sql before applying it`,
    `   the page reads lib/${segment}/policy.ts — replace the placeholder columns with the real ones`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { root: ".", dryRun: false, force: false, spec: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--spec") args.spec = argv[++i];
    else if (arg === "--root") args.root = argv[++i];
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--force") args.force = true;
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.spec) {
    console.error("Usage: node scripts/generate-module.mjs --spec module.json [--root .] [--dry-run] [--force]");
    process.exit(1);
  }

  const root = resolve(args.root);
  const spec = JSON.parse(readFileSync(resolve(args.spec), "utf8"));

  const { valid, errors } = validateSpec(spec);
  if (!valid) {
    console.error("Invalid module spec:");
    for (const error of errors) console.error(`  - ${error}`);
    process.exit(1);
  }

  const catalogKeys = readCatalogKeys(readFileSync(join(root, "lib/user-management.ts"), "utf8"));
  if (catalogKeys.includes(spec.moduleId)) {
    console.error(`moduleId "${spec.moduleId}" is already in portalModuleCatalog. Pick a new one.`);
    process.exit(1);
  }

  const files = buildModuleFiles(spec, { catalogKeys });

  const existing = files.map((file) => file.path).filter((path) => existsSync(join(root, path)));
  if (existing.length && !args.force) {
    console.error("Refusing to overwrite existing files (use --force):");
    for (const path of existing) console.error(`  - ${path}`);
    process.exit(1);
  }

  for (const file of files) {
    const target = join(root, file.path);
    if (args.dryRun) {
      console.log(`would write ${file.path} (${file.contents.split("\n").length} lines)`);
      continue;
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, file.contents, "utf8");
    console.log(`wrote ${file.path}`);
  }

  console.log("");
  console.log(wiringInstructions(spec));
}

// Only run the CLI when invoked directly, so the tests can import the builders.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main();
}
