import { redirect } from "next/navigation";
import { getSessionProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app-shell";
import { navFor } from "@/lib/nav";
import { GlobalIntakeEditor } from "@/components/global-intake-editor";
import type { QuoteField } from "@/lib/ai/intake";

export default async function GlobalIntakePage() {
  const session = await getSessionProfile();
  if (!session) redirect("/login");
  if (session.profile?.lender_user_type !== "admin") redirect("/");

  const supabase = await createClient();
  const { data: row } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "intake_global")
    .single();

  const v = (row?.value ?? {}) as {
    base_fields?: QuoteField[];
    style?: string | null;
    examples?: string | null;
  };

  const nav = navFor(session.profile);

  return (
    <AppShell email={session.profile?.email ?? ""} nav={nav}>
      <GlobalIntakeEditor
        initialBaseFields={Array.isArray(v.base_fields) ? v.base_fields : []}
        initialStyle={v.style ?? ""}
        initialExamples={v.examples ?? ""}
      />
    </AppShell>
  );
}
