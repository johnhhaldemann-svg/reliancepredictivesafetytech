"use server";

import { revalidatePath } from "next/cache";
import type { EmployeePayrollRun, EmployeePayrollRunItem } from "@/lib/company-data";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";
import { isPortalOwnerRole } from "@/lib/user-management";
import { recordAuditEvent, buildDataAuditEvent } from "@/lib/audit/events";
import {
  canMarkPayrollRunPaid,
  canMutatePayrollRunItem,
  canSetPayrollRunStatus,
  isPayrollItemStatus,
  payrollItemStatuses,
  payrollRunStatuses,
} from "@/lib/payroll/policy";

type EmployeeTimeCard = Database["public"]["Tables"]["employee_time_cards"]["Row"];
type EmployeeTimeCardPayroll = Database["public"]["Tables"]["employee_time_card_payroll"]["Row"];

type ActionResult<T> = {
  data: T | null;
  error: string | null;
};

type PayrollRunPayload = {
  run: EmployeePayrollRun;
  items: EmployeePayrollRunItem[];
};

function cleanText(value: unknown) {
  return String(value ?? "").trim();
}

function cleanOptional(value: unknown) {
  const text = cleanText(value);
  return text || null;
}

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

async function getCurrentUser() {
  const supabase = await createClient();

  if (!supabase) {
    return { user: null, error: "Supabase is not configured." };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { user: null, error: "You must be signed in." };
  }

  return { user, error: null };
}

async function requireOwner() {
  const { user, error } = await getCurrentUser();
  if (!user) return { user: null, error };

  const supabase = await createClient();
  if (!supabase) return { user: null, error: "Supabase is not configured." };

  const { data: role } = await supabase
    .from("user_roles")
    .select("role, account_status")
    .eq("user_id", user.id)
    .eq("account_status", "active")
    .maybeSingle();

  if (!isPortalOwnerRole(role?.role)) {
    return { user: null, error: "Owner access is required for payroll." };
  }

  return { user, error: null };
}

function getAdminClientOrError() {
  const admin = createAdminClient();
  if (!admin) {
    return { admin: null, error: "Supabase server admin key is required for payroll actions." };
  }

  return { admin, error: null };
}

function revalidatePayroll() {
  revalidatePath("/employee/payroll");
  revalidatePath("/employee");
}

/**
 * Wages move money, so every action here leaves a record. Until now none of
 * them did — this was the only money surface in the platform with no audit
 * trail, which meant a wrong figure could not be reconstructed after the fact.
 */
async function recordPayrollAudit(
  action: "create" | "update",
  entity: "employee_payroll_run" | "employee_payroll_run_item",
  entityId: string,
  userId: string,
  summary: string,
  before?: Record<string, unknown> | null,
  after?: Record<string, unknown> | null,
) {
  await recordAuditEvent({
    ...buildDataAuditEvent(action, entity, entityId, userId, summary, before, after),
    severity: "warn",
  });
}

function validatePeriod(periodStart: string, periodEnd: string) {
  if (!isIsoDate(periodStart) || !isIsoDate(periodEnd)) {
    return "Choose a valid payroll period.";
  }

  if (periodEnd < periodStart) {
    return "Payroll period end must be on or after the start date.";
  }

  return null;
}

export async function createPayrollRun(input: {
  periodStart: string;
  periodEnd: string;
  notes: string;
}): Promise<ActionResult<PayrollRunPayload>> {
  const owner = await requireOwner();
  if (!owner.user) return { data: null, error: owner.error };

  const { admin, error: adminError } = getAdminClientOrError();
  if (!admin) return { data: null, error: adminError };

  const periodStart = cleanText(input.periodStart);
  const periodEnd = cleanText(input.periodEnd);
  const periodError = validatePeriod(periodStart, periodEnd);
  if (periodError) return { data: null, error: periodError };

  const { data: approvedCards, error: cardsError } = await admin
    .from("employee_time_cards")
    .select("*")
    .eq("status", "approved")
    .gte("week_start", periodStart)
    .lte("week_end", periodEnd)
    .order("week_start", { ascending: true });

  if (cardsError) return { data: null, error: cardsError.message };

  const cardIds = ((approvedCards ?? []) as EmployeeTimeCard[]).map((card) => card.id);
  if (cardIds.length === 0) {
    return { data: null, error: "No approved time cards are available for this pay period." };
  }

  const [{ data: existingItems, error: existingError }, { data: payrollRows, error: payrollError }] = await Promise.all([
    admin.from("employee_payroll_run_items").select("time_card_id").in("time_card_id", cardIds),
    admin.from("employee_time_card_payroll").select("*").in("time_card_id", cardIds),
  ]);

  if (existingError) return { data: null, error: existingError.message };
  if (payrollError) return { data: null, error: payrollError.message };

  const usedCardIds = new Set((existingItems ?? []).map((item) => item.time_card_id));
  const payrollByCardId = new Map(((payrollRows ?? []) as EmployeeTimeCardPayroll[]).map((row) => [row.time_card_id, row]));
  const eligibleCards = ((approvedCards ?? []) as EmployeeTimeCard[]).filter((card) => !usedCardIds.has(card.id));

  const itemRows = eligibleCards
    .map((card) => {
      const payroll = payrollByCardId.get(card.id);
      if (!payroll) return null;

      return {
        time_card_id: card.id,
        employee_user_id: card.employee_user_id,
        total_hours: Number(payroll.total_hours),
        hourly_rate: Number(payroll.hourly_rate),
        gross_pay: Number(payroll.paid_value),
        item_status: "ready",
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));

  if (itemRows.length === 0) {
    return { data: null, error: "All approved time cards in this period are already assigned to a payroll run." };
  }

  const { data: run, error: runError } = await admin
    .from("employee_payroll_runs")
    .insert({
      period_start: periodStart,
      period_end: periodEnd,
      status: "draft",
      notes: cleanOptional(input.notes),
      created_by: owner.user.id,
    })
    .select("*")
    .single();

  if (runError || !run) {
    return { data: null, error: runError?.message ?? "Payroll run could not be created." };
  }

  const { data: items, error: itemsError } = await admin
    .from("employee_payroll_run_items")
    .insert(itemRows.map((row) => ({ ...row, payroll_run_id: run.id })))
    .select("*");

  if (itemsError) {
    await admin.from("employee_payroll_runs").delete().eq("id", run.id);
    return { data: null, error: itemsError.message };
  }

  await recordPayrollAudit(
    "create",
    "employee_payroll_run",
    run.id,
    owner.user.id,
    `Created payroll run for ${periodStart} to ${periodEnd} with ${items?.length ?? 0} time cards`,
    null,
    {
      period_start: periodStart,
      period_end: periodEnd,
      items: items?.length ?? 0,
      gross_total: itemRows.reduce((sum, row) => sum + row.gross_pay, 0),
    },
  );

  revalidatePayroll();
  return { data: { run: run as EmployeePayrollRun, items: (items ?? []) as EmployeePayrollRunItem[] }, error: null };
}

export async function updatePayrollRun(input: {
  runId: string;
  status?: string;
  notes?: string;
}): Promise<ActionResult<EmployeePayrollRun>> {
  const owner = await requireOwner();
  if (!owner.user) return { data: null, error: owner.error };

  const { admin, error: adminError } = getAdminClientOrError();
  if (!admin) return { data: null, error: adminError };

  const runId = cleanText(input.runId);
  const { data: current } = await admin
    .from("employee_payroll_runs")
    .select("id, status")
    .eq("id", runId)
    .maybeSingle();
  if (!current) return { data: null, error: "Payroll run not found." };

  const patch: Database["public"]["Tables"]["employee_payroll_runs"]["Update"] = {};
  const status = cleanText(input.status);

  if (status) {
    // Refuses an unknown status, refuses "paid" (that goes through
    // markPayrollRunPaid so the payment is stamped), and refuses ANY edit to a
    // run already paid — which previously would have moved it back to draft and
    // nulled paid_at/paid_by, erasing the evidence it was ever paid.
    const gate = canSetPayrollRunStatus(current.status, status);
    if (!gate.ok) return { data: null, error: gate.reason ?? "This status change is not allowed." };
    patch.status = status;
    patch.paid_at = null;
    patch.paid_by = null;
  }

  if (input.notes !== undefined) {
    patch.notes = cleanOptional(input.notes);
  }

  if (Object.keys(patch).length === 0) {
    return { data: null, error: "No payroll run changes were provided." };
  }

  // A notes-only edit still must not touch a paid run.
  if (!status) {
    const gate = canSetPayrollRunStatus(current.status, current.status);
    if (!gate.ok) return { data: null, error: gate.reason ?? "This payroll run can no longer be edited." };
  }

  const { data, error } = await admin
    .from("employee_payroll_runs")
    .update(patch)
    .eq("id", runId)
    // Guards the read-then-write against a concurrent transition.
    .eq("status", current.status)
    .select("*")
    .single();
  if (error) return { data: null, error: error.message };

  await recordPayrollAudit(
    "update",
    "employee_payroll_run",
    runId,
    owner.user.id,
    `Updated payroll run ${runId}${status ? ` (${current.status} -> ${status})` : " notes"}`,
    { status: current.status },
    patch as Record<string, unknown>,
  );

  revalidatePayroll();
  return { data: data as EmployeePayrollRun, error: null };
}

export async function markPayrollRunPaid(input: {
  runId: string;
}): Promise<ActionResult<PayrollRunPayload>> {
  const owner = await requireOwner();
  if (!owner.user) return { data: null, error: owner.error };

  const { admin, error: adminError } = getAdminClientOrError();
  if (!admin) return { data: null, error: adminError };

  const runId = cleanText(input.runId);

  // The precondition this action never had: it updated unconditionally, so a
  // stale page or a second session could re-stamp paid_at and paid_by on a run
  // that was already paid, and a run deliberately on hold could be paid anyway.
  const { data: current } = await admin
    .from("employee_payroll_runs")
    .select("id, status")
    .eq("id", runId)
    .maybeSingle();
  if (!current) return { data: null, error: "Payroll run not found." };

  const gate = canMarkPayrollRunPaid(current.status);
  if (!gate.ok) return { data: null, error: gate.reason ?? "This payroll run cannot be marked paid." };

  const { data: run, error: runError } = await admin
    .from("employee_payroll_runs")
    .update({ status: "paid", paid_at: new Date().toISOString(), paid_by: owner.user.id })
    .eq("id", runId)
    // Conditional on what was read: whichever write lands first wins, so two
    // concurrent clicks cannot both report a successful payment.
    .eq("status", current.status)
    .select("*")
    .single();

  if (runError || !run) {
    return {
      data: null,
      error: runError?.message ?? "This payroll run changed while you were looking at it. Reload before marking it paid.",
    };
  }

  const { data: items, error: itemsError } = await admin
    .from("employee_payroll_run_items")
    .update({ item_status: "paid" })
    .eq("payroll_run_id", runId)
    .select("*");

  if (itemsError) return { data: null, error: itemsError.message };

  await recordPayrollAudit(
    "update",
    "employee_payroll_run",
    runId,
    owner.user.id,
    `Marked payroll run ${runId} paid (${items?.length ?? 0} items) for ${run.period_start} to ${run.period_end}`,
    { status: current.status, paid_at: null },
    { status: "paid", paid_at: run.paid_at, paid_by: owner.user.id, items: items?.length ?? 0 },
  );

  revalidatePayroll();
  return { data: { run: run as EmployeePayrollRun, items: (items ?? []) as EmployeePayrollRunItem[] }, error: null };
}

export async function updatePayrollRunItem(input: {
  itemId: string;
  itemStatus?: string;
  notes?: string;
  federalTax?: number;
  stateTax?: number;
  socialSecurity?: number;
  medicare?: number;
  otherDeductions?: number;
}): Promise<ActionResult<EmployeePayrollRunItem>> {
  const owner = await requireOwner();
  if (!owner.user) return { data: null, error: owner.error };

  const { admin, error: adminError } = getAdminClientOrError();
  if (!admin) return { data: null, error: adminError };

  const itemId = cleanText(input.itemId);

  // Items inherit the freeze from the run that owns them: editing deductions on
  // a run whose money has already gone out would silently change the record of
  // what was paid.
  const { data: existingItem } = await admin
    .from("employee_payroll_run_items")
    .select("id, payroll_run_id, item_status")
    .eq("id", itemId)
    .maybeSingle();
  if (!existingItem) return { data: null, error: "Payroll item not found." };

  const { data: parentRun } = await admin
    .from("employee_payroll_runs")
    .select("status")
    .eq("id", existingItem.payroll_run_id)
    .maybeSingle();

  const runGate = canMutatePayrollRunItem(parentRun?.status);
  if (!runGate.ok) return { data: null, error: runGate.reason ?? "This payroll item can no longer be edited." };

  const patch: Database["public"]["Tables"]["employee_payroll_run_items"]["Update"] = {};
  const itemStatus = cleanText(input.itemStatus);

  if (itemStatus) {
    if (!isPayrollItemStatus(itemStatus)) {
      return { data: null, error: `Choose a valid payroll item status (${payrollItemStatuses.join(", ")}).` };
    }
    patch.item_status = itemStatus;
  }

  if (input.notes !== undefined) {
    patch.notes = cleanOptional(input.notes);
  }

  if (input.federalTax !== undefined) patch.federal_tax = Math.max(0, Number(input.federalTax));
  if (input.stateTax !== undefined) patch.state_tax = Math.max(0, Number(input.stateTax));
  if (input.socialSecurity !== undefined) patch.social_security = Math.max(0, Number(input.socialSecurity));
  if (input.medicare !== undefined) patch.medicare = Math.max(0, Number(input.medicare));
  if (input.otherDeductions !== undefined) patch.other_deductions = Math.max(0, Number(input.otherDeductions));

  if (Object.keys(patch).length === 0) {
    return { data: null, error: "No payroll item changes were provided." };
  }

  const { data, error } = await admin.from("employee_payroll_run_items").update(patch).eq("id", itemId).select("*").single();
  if (error) return { data: null, error: error.message };

  await recordPayrollAudit(
    "update",
    "employee_payroll_run_item",
    itemId,
    owner.user.id,
    `Updated payroll item ${itemId} on run ${existingItem.payroll_run_id}`,
    { item_status: existingItem.item_status },
    patch as Record<string, unknown>,
  );

  revalidatePayroll();
  return { data: data as EmployeePayrollRunItem, error: null };
}
