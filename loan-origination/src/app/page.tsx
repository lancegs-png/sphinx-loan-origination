import { redirect } from "next/navigation";
import { getSessionProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadGuarantorNames } from "@/lib/fields";
import { PipelineHome } from "@/components/pipeline-home";
import { LoanPicker } from "@/components/loan-picker";
import type { Loan } from "@/lib/types";

export default async function Home() {
  const session = await getSessionProfile();
  if (!session) redirect("/login");
  const { profile } = session;
  if (!profile) redirect("/login");

  const supabase = await createClient();
  const { data } = await supabase
    .from("loans")
    .select("*")
    .order("created_at", { ascending: false });
  // Hide archived loans from the pipeline (they stay in the DB and can be unarchived).
  // Filtered in code, not in the query, so this is safe even before the enum value exists.
  const loans = ((data as Loan[]) ?? []).filter((l) => l.status !== "archived");

  // Lending team → Pipeline home (R-AUTH-7, R-UI-8).
  if (profile.is_lending_team) {
    const guarantors = await loadGuarantorNames(supabase);
    return <PipelineHome loans={loans} profile={profile} guarantors={guarantors} />;
  }

  // Borrower/originator: one loan → open it; multiple → picker (R-UI-10).
  if (loans.length === 1) redirect(`/loans/${loans[0].id}`);
  return <LoanPicker loans={loans} email={profile.email} />;
}
