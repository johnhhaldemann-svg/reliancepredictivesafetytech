"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export async function getAuditEvents(limit = 100, category?: string) {
  const supabase = await createClient();
  if (!supabase) { redirect("/employee-login?message=supabase-required"); }
  let query = supabase
    .from("platform_audit_events")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (category) query = query.eq("event_category", category);
  const { data } = await query;
  return data ?? [];
}
