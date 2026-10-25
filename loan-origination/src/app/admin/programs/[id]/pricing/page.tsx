import { notFound, redirect } from "next/navigation";
import { getSessionProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ProgramPricingEditor } from "@/components/program-pricing-editor";

export default async function PricingPage({ params }: { params: Promise<{ id: string }> }) {
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

  const { data: pricing } = await supabase
    .from("program_pricing")
    .select("mode,guidelines,model")
    .eq("program_id", id)
    .single();

  return (
    <ProgramPricingEditor
      programId={id}
      programName={program.name}
      initialMode={(pricing?.mode as "model" | "guidelines") ?? "guidelines"}
      initialGuidelines={pricing?.guidelines ?? ""}
      initialModel={(pricing?.model as Record<string, string | number>) ?? {}}
    />
  );
}
