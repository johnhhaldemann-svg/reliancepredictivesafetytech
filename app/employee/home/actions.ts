"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  dashboardCookieName,
  dashboardCookieOptions,
  dashboardVariantPath,
  parseDashboardVariant,
} from "@/lib/dashboard/preference";

/**
 * Remember which dashboard this person wants, then take them to it.
 *
 * No auth check on purpose: this writes a display preference, reads nothing
 * and grants nothing. Both destinations run their own permission check, so a
 * cookie cannot open a door.
 */
export async function chooseDashboard(formData: FormData) {
  const variant = parseDashboardVariant(String(formData.get("variant") ?? ""));

  const store = await cookies();
  store.set(dashboardCookieName, variant, dashboardCookieOptions());

  revalidatePath("/employee");
  revalidatePath("/employee/home");

  // redirect() throws to unwind — nothing may follow it in this function.
  redirect(dashboardVariantPath(variant));
}
