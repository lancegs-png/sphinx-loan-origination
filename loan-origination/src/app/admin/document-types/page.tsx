import { redirect } from "next/navigation";
import { getSessionProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app-shell";
import { navFor } from "@/lib/nav";
import { DocumentTypesEditor, type DocType } from "@/components/document-types-editor";

export default async function DocumentTypesPage() {
  const session = await getSessionProfile();
  if (!session) redirect("/login");
  if (session.profile?.lender_user_type !== "admin") redirect("/");

  const supabase = await createClient();
  const { data } = await supabase
    .from("document_types")
    .select("id,name,default_naming_convention,default_review_rules")
    .order("name");

  const nav = navFor(session.profile);

  return (
    <AppShell email={session.profile?.email ?? ""} nav={nav}>
      <DocumentTypesEditor initial={(data as DocType[]) ?? []} />
    </AppShell>
  );
}
