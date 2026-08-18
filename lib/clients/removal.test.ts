import { describe, expect, it } from "vitest";
import { clientStatuses } from "@/lib/company-data";
import { portalUserRoles } from "@/lib/user-management";
import {
  isLiveClient,
  isRemovedClient,
  removedClientStatus,
  resolveClientRemovalFlags,
  resolveIncludeRemoved,
  restoredClientStatus,
} from "./removal";

const denied = { canRemove: false, canRestore: false };
const granted = { canRemove: true, canRestore: true };

describe("removal status constants", () => {
  // Both are written into company_clients.status, a free-text column shared
  // with the company profile form's Status input. If either drifts out of the
  // declared set the two surfaces stop agreeing on what "removed" means.
  it("uses statuses the platform already declares", () => {
    expect(clientStatuses).toContain(removedClientStatus);
    expect(clientStatuses).toContain(restoredClientStatus);
  });

  it("does not restore to the removed status", () => {
    expect(restoredClientStatus).not.toBe(removedClientStatus);
  });
});

describe("isRemovedClient", () => {
  it("recognises a company removed through the button", () => {
    expect(isRemovedClient(removedClientStatus)).toBe(true);
  });

  // status has no CHECK constraint and the profile form is a plain text input,
  // so a hand-typed value has to hide the company too.
  it("recognises the status typed by hand, in any case or padding", () => {
    expect(isRemovedClient("archived")).toBe(true);
    expect(isRemovedClient("ARCHIVED")).toBe(true);
    expect(isRemovedClient("  Archived  ")).toBe(true);
  });

  it("leaves every other status live", () => {
    for (const status of ["Active", "Paused", "Lost", "", "Renewing"]) {
      expect(isRemovedClient(status), status || "(empty)").toBe(false);
      expect(isLiveClient(status), status || "(empty)").toBe(true);
    }
  });

  // A company created before this column was populated must stay on the board.
  it("treats a missing status as live", () => {
    expect(isRemovedClient(null)).toBe(false);
    expect(isRemovedClient(undefined)).toBe(false);
    expect(isLiveClient(null)).toBe(true);
  });
});

describe("resolveIncludeRemoved", () => {
  it("hides removed companies unless the viewer explicitly asks", () => {
    expect(resolveIncludeRemoved(undefined)).toBe(false);
    expect(resolveIncludeRemoved("")).toBe(false);
    expect(resolveIncludeRemoved("0")).toBe(false);
    expect(resolveIncludeRemoved("true")).toBe(false);
    expect(resolveIncludeRemoved("yes")).toBe(false);
  });

  it("shows them for the one value the directory link sets", () => {
    expect(resolveIncludeRemoved("1")).toBe(true);
    expect(resolveIncludeRemoved(" 1 ")).toBe(true);
  });
});

describe("resolveClientRemovalFlags", () => {
  // The permission matrix: the same audience the company_clients UPDATE policy
  // grants on, so the UI never offers a button RLS would reject — or hide one
  // it would have honoured.
  it("lets every active portal role remove and restore", () => {
    for (const role of portalUserRoles) {
      expect(resolveClientRemovalFlags(role, true), role).toEqual(granted);
    }
  });

  it("denies an inactive account, whatever role it holds", () => {
    for (const role of portalUserRoles) {
      expect(resolveClientRemovalFlags(role, false), `inactive ${role}`).toEqual(denied);
    }
  });

  it("denies a role outside the portal whitelist", () => {
    for (const role of [null, undefined, "", "client_user", "super_admin ", "SUPER_ADMIN"]) {
      expect(resolveClientRemovalFlags(role, true), String(role)).toEqual(denied);
    }
  });
});
