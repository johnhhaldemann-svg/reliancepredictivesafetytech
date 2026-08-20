import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildModuleFiles,
  migrationStamp,
  pascalCase,
  readCatalogKeys,
  routeSegment,
  validateSpec,
  wiringInstructions,
} from "./generate-module.mjs";

const ROOT = join(import.meta.dirname, "..");

const spec = {
  moduleId: "safety_observations",
  label: "Safety Observations",
  group: "Governance",
  pathPrefix: "/employee/observations",
  purpose: "Log and close field safety observations.",
  rolesAllowed: ["admin", "company_admin"],
  dataObjects: ["company_safety_observations"],
  workflowStates: ["open", "in_progress", "closed"],
  acceptanceCriteria: [
    "An active employee can log an observation",
    "An archived account cannot",
  ],
};

const build = (overrides = {}) =>
  buildModuleFiles({ ...spec, ...overrides }, { catalogKeys: ["dashboard", "file_center"], stamp: "20260901120000" });

const fileAt = (files, suffix) => files.find((file) => file.path.endsWith(suffix));

describe("validateSpec", () => {
  it("accepts a complete spec", () => {
    expect(validateSpec(spec)).toEqual({ valid: true, errors: [] });
  });

  it("rejects a camelCase moduleId", () => {
    const { errors } = validateSpec({ ...spec, moduleId: "safetyObservations" });
    expect(errors.some((e) => e.includes("snake_case"))).toBe(true);
  });

  it("rejects a pathPrefix outside /employee/", () => {
    const { errors } = validateSpec({ ...spec, pathPrefix: "/admin/observations" });
    expect(errors.some((e) => e.includes("pathPrefix"))).toBe(true);
  });

  it("rejects fewer than two acceptance criteria", () => {
    const { errors } = validateSpec({ ...spec, acceptanceCriteria: ["only one"] });
    expect(errors.some((e) => e.includes("acceptanceCriteria"))).toBe(true);
  });

  it("rejects a table name that is not snake_case", () => {
    const { errors } = validateSpec({ ...spec, dataObjects: ["CompanyObservations"] });
    expect(errors.some((e) => e.includes("snake_case table name"))).toBe(true);
  });

  it("holds Platform modules to the stricter contract", () => {
    const platform = { ...spec, group: "Platform", pathPrefix: "/employee/platform/observations" };
    const { errors } = validateSpec(platform);
    expect(errors).toContain("Platform group modules must set platformRolesOnly: true");
    expect(errors).toContain("Platform group modules must have minimumTestScenarios >= 5");
    expect(validateSpec({ ...platform, platformRolesOnly: true, minimumTestScenarios: 5 }).valid).toBe(true);
  });
});

describe("derivations", () => {
  it("derives the route segment, and the names built from it", () => {
    expect(routeSegment("/employee/observations")).toBe("observations");
    expect(routeSegment("/employee/time-off/")).toBe("time-off");
    expect(pascalCase("time-off")).toBe("TimeOff");
  });

  it("stamps migrations in UTC, in the repo's filename format", () => {
    expect(migrationStamp(new Date(Date.UTC(2026, 8, 1, 7, 5, 3)))).toBe("20260901070503");
  });

  it("reads every module key out of the real catalog", () => {
    const keys = readCatalogKeys(readFileSync(join(ROOT, "lib/user-management.ts"), "utf8"));
    expect(keys).toContain("dashboard");
    expect(keys).toContain("file_center");
    expect(keys.length).toBeGreaterThan(20);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("throws rather than silently emitting an empty constraint", () => {
    expect(() => readCatalogKeys("export const somethingElse = [];")).toThrow(/portalModuleCatalog/);
  });
});

describe("buildModuleFiles", () => {
  it("refuses to build from an invalid spec", () => {
    expect(() => build({ moduleId: "Nope" })).toThrow(/Invalid module spec/);
  });

  it("emits the full set the module contract requires", () => {
    const paths = build().map((file) => file.path);
    expect(paths).toEqual([
      "app/employee/observations/page.tsx",
      "app/employee/observations/loading.tsx",
      "app/employee/observations/error.tsx",
      "lib/observations/access.ts",
      "lib/observations/policy.ts",
      "lib/observations/policy.test.ts",
      "supabase/migrations/20260901120000_safety_observations.sql",
    ]);
  });

  it("ships a loading skeleton and an error boundary, the two that get forgotten", () => {
    const files = build();
    expect(fileAt(files, "loading.tsx").contents).toContain("export default function Loading()");
    expect(fileAt(files, "error.tsx").contents).toContain('"use client"');
    expect(fileAt(files, "error.tsx").contents).toContain("reset");
  });
});

describe("the generated migration", () => {
  const sql = () => fileAt(build(), ".sql").contents;

  it("enables RLS and grants no blanket access", () => {
    expect(sql()).toContain("alter table public.company_safety_observations enable row level security");
    expect(sql()).toContain("public.is_company_portal_employee()");
  });

  it("keeps DELETE admin-only", () => {
    expect(sql()).toMatch(/for delete to authenticated using \(public\.is_company_portal_admin\(\)\)/);
  });

  it("forces inserts to self-attribute, so a row cannot be planted in someone else's name", () => {
    expect(sql()).toContain("created_by = (select auth.uid())");
  });

  it("installs the updated_at trigger", () => {
    expect(sql()).toContain("execute function public.set_updated_at()");
  });

  it("regenerates the module_key constraint from the whole catalog plus the new key", () => {
    const text = sql();
    expect(text).toContain("drop constraint if exists portal_user_module_access_module_key_check");
    expect(text).toContain("'dashboard'");
    expect(text).toContain("'file_center'");
    expect(text).toContain("'safety_observations'");
  });

  it("never lists the new key twice, even if it is already in the catalog", () => {
    // The key also appears in the backfill INSERT, so count inside the CHECK
    // block only — a duplicate there is what Postgres would reject.
    const files = buildModuleFiles(spec, { catalogKeys: ["dashboard", "safety_observations"], stamp: "20260901120000" });
    const text = fileAt(files, ".sql").contents;
    const start = text.indexOf("add constraint portal_user_module_access_module_key_check");
    const block = text.slice(start, text.indexOf(");", start));
    const keys = [...block.matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]);
    expect(keys).toEqual(["dashboard", "safety_observations"]);
  });

  it("carries a rollback block, which the release gate requires", () => {
    expect(sql()).toContain("-- ROLLBACK");
    expect(sql()).toContain("drop table if exists public.company_safety_observations cascade;");
  });

  it("constrains the workflow states it was given", () => {
    expect(sql()).toContain("check (status in ('open', 'in_progress', 'closed'))");
  });

  it("omits the status column and its index when the module has no workflow", () => {
    // account_status appears in the backfill regardless, so this asserts on the
    // column definition and the index, not on the word.
    const text = fileAt(build({ workflowStates: undefined }), ".sql").contents;
    expect(text).not.toMatch(/^\s+status\s+text/m);
    expect(text).not.toContain("_status_idx");
    expect(text).not.toContain("check (status in");
  });

  it("escapes a quote in the purpose rather than breaking the comment", () => {
    const text = fileAt(build({ purpose: "Track the crew's observations." }), ".sql").contents;
    expect(text).toContain("Track the crew''s observations.");
  });
});

describe("the generated policy and its test", () => {
  it("denies an archived admin — the check the role row alone would miss", () => {
    const policy = fileAt(build(), "lib/observations/policy.ts").contents;
    expect(policy).toContain("if (!isActive || !role) return { isAdmin: false }");
  });

  it("generates a forward-only state machine when the module has states", () => {
    const policy = fileAt(build(), "lib/observations/policy.ts").contents;
    expect(policy).toContain("return toIndex > fromIndex;");
  });

  it("omits the state machine when there are no states to move between", () => {
    const policy = fileAt(build({ workflowStates: undefined }), "lib/observations/policy.ts").contents;
    expect(policy).not.toContain("canTransition");
    const test = fileAt(build({ workflowStates: undefined }), "policy.test.ts").contents;
    expect(test).not.toContain("canTransition");
  });

  it("writes the acceptance criteria into the test file, where they get read", () => {
    const test = fileAt(build(), "policy.test.ts").contents;
    for (const criterion of spec.acceptanceCriteria) expect(test).toContain(criterion);
  });
});

describe("wiringInstructions", () => {
  it("prints the two edits a generator should not make blindly", () => {
    const text = wiringInstructions(spec);
    expect(text).toContain('{ key: "safety_observations", label: "Safety Observations", group: "Governance", pathPrefixes: ["/employee/observations"] },');
    expect(text).toContain('{ href: "/employee/observations", label: "Safety Observations", icon: FileText },');
    expect(text).toContain("npm run typecheck && npm test");
  });
});
