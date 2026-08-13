import { EmployeePresenceChat } from "@/components/EmployeePresenceChat";
import { EmployeeSidebar } from "@/components/EmployeeSidebar";
import { isMissingSchemaRelationError } from "@/lib/supabase/errors";
import { getSessionContext } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";
import { hasFullPortalVisibility, isPortalOwnerRole } from "@/lib/user-management";

type EmployeeChatProfile = Database["public"]["Tables"]["employee_chat_profiles"]["Row"];
type EmployeeChatThread = Database["public"]["Tables"]["employee_chat_threads"]["Row"];
type EmployeeChatMessage = Database["public"]["Tables"]["employee_chat_messages"]["Row"];

function getChatDisplayName(profile: EmployeeChatProfile | undefined, email: string | null | undefined) {
  return profile?.display_name || email || profile?.user_id.slice(0, 8) || "Employee";
}

export default async function EmployeeLayout({ children }: { children: React.ReactNode }) {
  // Shared with the page rendering inside this layout: getSessionContext is
  // request-memoized, so the auth round trip and the role lookup happen once
  // for the whole render instead of once here and again in the page.
  const session = await getSessionContext();
  const supabase = session.supabase;
  const user = session.user;
  let chatProps: React.ComponentProps<typeof EmployeePresenceChat> | null = null;
  let currentRole: { role: string; account_status: string } | null = null;
  let canAccessFinance = false;
  let moduleKeys: string[] = [];
  let pendingOnboardingCount = 0;
  let unreadNotificationCount = 0;
  let unreadChatNotificationCount = 0;

  if (supabase && user) {
    // Preserves the previous semantics exactly: the old query filtered on
    // account_status = 'active', so a suspended user's role never reached the
    // sidebar. getSessionContext returns the row either way, so the filter
    // moves here rather than disappearing.
    const role = session.isActive ? { role: session.role ?? "", account_status: session.accountStatus ?? "" } : null;
    currentRole = role;
    const isOwner = session.isActive && isPortalOwnerRole(session.role);

    const [
      { data: profiles, error: profilesError },
      { data: companyThread, error: companyThreadError },
      { count: notificationCount, error: notificationCountError },
      { count: chatNotificationCount, error: chatNotificationCountError },
      { data: financeAuthorization, error: financeAuthorizationError },
      { data: moduleAccess, error: moduleAccessError },
      { count: pendingOnboardingRaw, error: pendingOnboardingError },
    ] = await Promise.all([
      supabase.from("employee_chat_profiles").select("*").order("display_name"),
      supabase.from("employee_chat_threads").select("*").eq("thread_type", "company").maybeSingle(),
      supabase
        .from("portal_notifications")
        .select("*", { count: "exact", head: true })
        .eq("recipient_user_id", user.id)
        .eq("status", "unread"),
      supabase
        .from("portal_notifications")
        .select("*", { count: "exact", head: true })
        .eq("recipient_user_id", user.id)
        .eq("status", "unread")
        .eq("source_type", "employee_chat_message"),
      supabase.from("company_finance_authorized_users").select("user_id").eq("user_id", user.id).maybeSingle(),
      hasFullPortalVisibility(role?.role, role?.account_status)
        ? Promise.resolve({ data: [], error: null })
        : supabase.from("portal_user_module_access").select("module_key").eq("user_id", user.id),
      supabase
        .from("employee_document_assignments")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("status", "pending"),
    ]);

    if (
      (profilesError && !isMissingSchemaRelationError(profilesError)) ||
      (companyThreadError && !isMissingSchemaRelationError(companyThreadError)) ||
      (notificationCountError && !isMissingSchemaRelationError(notificationCountError)) ||
      (chatNotificationCountError && !isMissingSchemaRelationError(chatNotificationCountError)) ||
      (financeAuthorizationError && !isMissingSchemaRelationError(financeAuthorizationError)) ||
      (moduleAccessError && !isMissingSchemaRelationError(moduleAccessError)) ||
      (pendingOnboardingError && !isMissingSchemaRelationError(pendingOnboardingError))
    ) {
      console.error(
        "Could not load employee shell data.",
        profilesError ?? companyThreadError ?? notificationCountError ?? chatNotificationCountError ?? financeAuthorizationError ?? moduleAccessError,
      );
    }

    canAccessFinance = Boolean(isOwner || financeAuthorization);
    moduleKeys = (moduleAccess ?? []).map((access) => access.module_key);
    pendingOnboardingCount = pendingOnboardingRaw ?? 0;
    unreadNotificationCount = notificationCount ?? 0;
    unreadChatNotificationCount = chatNotificationCount ?? 0;

    const typedCompanyThread = (companyThread ?? null) as EmployeeChatThread | null;
    const { data: companyMessages, error: companyMessagesError } = typedCompanyThread
      ? await supabase
          .from("employee_chat_messages")
          .select("*")
          .eq("thread_id", typedCompanyThread.id)
          .order("created_at", { ascending: false })
          .limit(80)
      : { data: [], error: null };

    if (companyMessagesError && !isMissingSchemaRelationError(companyMessagesError)) {
      console.error("Could not load employee chat messages.", companyMessagesError);
    }

    const typedProfiles = (profiles ?? []) as EmployeeChatProfile[];
    const currentProfile = typedProfiles.find((profile) => profile.user_id === user.id);

    if (typedCompanyThread && !profilesError && !companyMessagesError) {
      chatProps = {
        currentUser: {
          id: user.id,
          displayName: getChatDisplayName(currentProfile, user.email),
          email: user.email ?? currentProfile?.email ?? null,
        },
        companyThread: typedCompanyThread,
        initialProfiles: typedProfiles,
        initialCompanyMessages: ([...(companyMessages ?? [])].reverse()) as EmployeeChatMessage[],
        initialUnreadChatNotificationCount: unreadChatNotificationCount,
      };
    }
  }

  return (
    <div className="portal-shell">
      <EmployeeSidebar
        accountStatus={currentRole?.account_status}
        canAccessFinance={canAccessFinance}
        currentRole={currentRole?.role}
        moduleKeys={moduleKeys}
        pendingOnboardingCount={pendingOnboardingCount}
        unreadNotificationCount={unreadNotificationCount}
      />
      <main className="portal-main">{children}</main>
      {chatProps ? <EmployeePresenceChat {...chatProps} /> : null}
    </div>
  );
}
