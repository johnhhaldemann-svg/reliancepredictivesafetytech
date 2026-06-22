"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export async function getRunbooks() {
  const supabase = await createClient();
  if (!supabase) { redirect("/employee-login?message=supabase-required"); }
  const { data } = await supabase
    .from("platform_runbooks")
    .select("*")
    .order("category")
    .order("title");
  return data ?? [];
}

export async function createRunbook(form: FormData) {
  const supabase = await createClient();
  if (!supabase) { redirect("/employee-login?message=supabase-required"); }
  const { data: { user } } = await supabase.auth.getUser();
  await supabase.from("platform_runbooks").insert({
    category: String(form.get("category") ?? "general"),
    title: String(form.get("title")),
    content: String(form.get("content") ?? ""),
    created_by: user?.id ?? null,
  });
  revalidatePath("/employee/platform/docs");
}

export async function updateRunbook(id: string, content: string) {
  const supabase = await createClient();
  if (!supabase) { redirect("/employee-login?message=supabase-required"); }
  await supabase.from("platform_runbooks").update({ content }).eq("id", id);
  revalidatePath("/employee/platform/docs");
}

export async function markRunbookReviewed(id: string) {
  const supabase = await createClient();
  if (!supabase) { redirect("/employee-login?message=supabase-required"); }
  const { data: { user } } = await supabase.auth.getUser();
  await supabase.from("platform_runbooks").update({
    last_reviewed_at: new Date().toISOString(),
    reviewed_by: user?.id ?? null,
  }).eq("id", id);
  revalidatePath("/employee/platform/docs");
}
