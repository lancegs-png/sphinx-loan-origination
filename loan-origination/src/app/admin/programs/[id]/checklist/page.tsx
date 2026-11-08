import { notFound, redirect } from "next/navigation";
import { getSessionProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app-shell";
import { navFor } from "@/lib/nav";
import { ProgramChecklistEditor } from "@/components/program-checklist-editor";

export default async function ChecklistPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSessionProfile();
  if (!session) redirect("/login");
  if (session.profile?.lender_user_type !== "admin") redirect("/");

  const supabase = await createClient();
  const { data: program } = await supabase
    .from("loan_programs")
    .select("id,name")
    .eq("id", id)
    .single();
  if (!program) notFound();

  const { data: docTypes } = await supabase
    .from("document_types")
    .select("id,name")
    .order("name");
  const { data: items } = await supabase
    .from("program_checklist_items")
    .select("document_type_id,required,assignee,naming_override,review_rules_override")
    .eq("program_id", id);

  const nav = navFor(session.profile);

  return (
    <AppShell email={session.profile?.email ?? ""} nav={nav}>
      <ProgramChecklistEditor
        programId={id}
        programName={program.name}
        docTypes={(docTypes as { id: string; name: string }[]) ?? []}
        items={
          (items as {
            document_type_id: string;
            required: boolean;
            assignee: string;
            naming_override: string | null;
            review_rules_override: string | null;
          }[]) ?? []
        }
      />
    </AppShell>
  );
}
