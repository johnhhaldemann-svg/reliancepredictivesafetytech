"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export async function getSubscriptionTiers() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("platform_subscription_tiers")
    .select("*")
    .eq("is_active", true)
    .order("sort_order");
  return data ?? [];
}

export async function getTenantSubscriptions() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("platform_tenant_subscriptions")
    .select("*, platform_subscription_tiers(name, tier_key)")
    .order("created_at", { ascending: false });
  return data ?? [];
}

export async function createTenantSubscription(form: FormData) {
  const supabase = await createClient();
  const trialDays = 14;
  const trialEndsAt = new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000).toISOString();
  await supabase.from("platform_tenant_subscriptions").insert({
    tenant_name: String(form.get("tenant_name")),
    tenant_email: form.get("tenant_email") ? String(form.get("tenant_email")) : null,
    tier_id: form.get("tier_id") ? String(form.get("tier_id")) : null,
    status: "trial",
    trial_ends_at: trialEndsAt,
    notes: form.get("notes") ? String(form.get("notes")) : null,
  });
  revalidatePath("/employee/platform/billing");
}

export async function updateSubscriptionStatus(id: string, status: string) {
  const supabase = await createClient();
  await supabase.from("platform_tenant_subscriptions").update({ status }).eq("id", id);
  revalidatePath("/employee/platform/billing");
}

export async function updateSubscriptionTier(form: FormData) {
  const supabase = await createClient();
  await supabase.from("platform_subscription_tiers").upsert({
    tier_key: String(form.get("tier_key")),
    name: String(form.get("name")),
    description: String(form.get("description") ?? ""),
    monthly_price_cents: Number(form.get("monthly_price_cents") ?? 0),
    annual_price_cents: Number(form.get("annual_price_cents") ?? 0),
    max_users: form.get("max_users") ? Number(form.get("max_users")) : null,
    sort_order: Number(form.get("sort_order") ?? 0),
  }, { onConflict: "tier_key" });
  revalidatePath("/employee/platform/billing");
}
