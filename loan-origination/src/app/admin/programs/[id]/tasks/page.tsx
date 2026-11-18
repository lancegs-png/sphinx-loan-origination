import { notFound, redirect } from "next/navigation";
import { getSessionProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app-shell";
import { navFor } from "@/lib/nav";
import { ProgramStageTasksEditor } from "@/components/program-stage-tasks-editor";

export default async function StageTasksPage({ params }: { params: Promise<{ id: string }> }) {
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

  const { data: tasks } = await supabase
    .from("program_stage_tasks")
    .select("id,stage_bucket,label,sort")
    .eq("program_id", id)
    .order("sort");

  const nav = navFor(session.profile);

  return (
    <AppShell email={session.profile?.email ?? ""} nav={nav}>
      <ProgramStageTasksEditor
        programId={id}
        programName={program.name}
        tasks={
          (tasks as { id: string; stage_bucket: string; label: string; sort: number }[]) ?? []
        }
      />
    </AppShell>
  );
}
