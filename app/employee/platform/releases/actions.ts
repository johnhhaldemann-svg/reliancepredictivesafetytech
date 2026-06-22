"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export async function getReleases() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("platform_releases")
    .select("*")
    .order("created_at", { ascending: false });
  return data ?? [];
}

export async function createRelease(form: FormData) {
  const supabase = await createClient();
  await supabase.from("platform_releases").insert({
    version: String(form.get("version")),
    title: String(form.get("title")),
    environment: String(form.get("environment") ?? "development"),
    release_notes: form.get("release_notes") ? String(form.get("release_notes")) : null,
    migration_required: form.get("migration_required") === "on",
    rollback_plan: form.get("rollback_plan") ? String(form.get("rollback_plan")) : null,
  });
  revalidatePath("/employee/platform/releases");
}

export async function updateReleaseStatus(id: string, status: string) {
  const supabase = await createClient();
  const updates: Record<string, unknown> = { status };
  if (status === "deployed") updates.deployed_at = new Date().toISOString();
  await supabase.from("platform_releases").update(updates).eq("id", id);
  revalidatePath("/employee/platform/releases");
}

export async function signOffRelease(id: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  await supabase.from("platform_releases").update({
    signed_off_by: user?.id ?? null,
    signed_off_at: new Date().toISOString(),
  }).eq("id", id);
  revalidatePath("/employee/platform/releases");
}
