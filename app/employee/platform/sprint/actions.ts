"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export async function getSprintsWithTasks() {
  const supabase = await createClient();
  const { data: sprints } = await supabase
    .from("platform_sprints")
    .select("*, platform_sprint_tasks(*)")
    .order("sprint_number", { ascending: false });
  return sprints ?? [];
}

export async function createSprint(form: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  await supabase.from("platform_sprints").insert({
    sprint_number: Number(form.get("sprint_number")),
    title: String(form.get("title")),
    goal: form.get("goal") ? String(form.get("goal")) : null,
    start_date: String(form.get("start_date")),
    end_date: String(form.get("end_date")),
    capacity_points: form.get("capacity_points") ? Number(form.get("capacity_points")) : null,
    created_by: user?.id ?? null,
  });
  revalidatePath("/employee/platform/sprint");
}

export async function updateSprintStatus(id: string, status: string) {
  const supabase = await createClient();
  await supabase.from("platform_sprints").update({ status }).eq("id", id);
  revalidatePath("/employee/platform/sprint");
}

export async function createTask(form: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  await supabase.from("platform_sprint_tasks").insert({
    sprint_id: String(form.get("sprint_id")),
    title: String(form.get("title")),
    description: form.get("description") ? String(form.get("description")) : null,
    priority: String(form.get("priority") ?? "medium"),
    estimate_points: form.get("estimate_points") ? Number(form.get("estimate_points")) : null,
    assigned_to: user?.id ?? null,
  });
  revalidatePath("/employee/platform/sprint");
}

export async function updateTaskStatus(id: string, status: string) {
  const supabase = await createClient();
  await supabase.from("platform_sprint_tasks").update({ status }).eq("id", id);
  revalidatePath("/employee/platform/sprint");
}
