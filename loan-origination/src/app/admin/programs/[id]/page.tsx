import { notFound, redirect } from "next/navigation";
import { getSessionProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell, type NavItem } from "@/components/app-shell";
import { ProgramConfigEditor } from "@/components/program-config-editor";
import type { QuoteField } from "@/lib/ai/intake";

export default async function ProgramConfigPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
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

  const { data: cfg } = await supabase
    .from("program_ai_config")
    .select("quote_fields,intake_style,intake_examples")
    .eq("program_id", id)
    .single();

  const nav: NavItem[] = [
    { href: "/", label: "Pipeline", icon: "pipeline", match: "exact" },
    { href: "/admin", label: "Settings", icon: "settings", match: "prefix" },
  ];

  return (
    <AppShell email={session.profile?.email ?? ""} nav={nav}>
      <ProgramConfigEditor
        programId={id}
        programName={program.name}
        initialQuoteFields={Array.isArray(cfg?.quote_fields) ? (cfg!.quote_fields as QuoteField[]) : []}
        initialStyle={cfg?.intake_style ?? ""}
        initialExamples={cfg?.intake_examples ?? ""}
      />
    </AppShell>
  );
}
