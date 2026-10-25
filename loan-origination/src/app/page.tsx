import { redirect } from "next/navigation";
import { getSessionProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
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
  const loans = (data as Loan[]) ?? [];

  // Lending team → Pipeline home (R-AUTH-7, R-UI-8).
  if (profile.is_lending_team) {
    return <PipelineHome loans={loans} profile={profile} />;
  }

  // Borrower/originator: one loan → open it; multiple → picker (R-UI-10).
  if (loans.length === 1) redirect(`/loans/${loans[0].id}`);
  return <LoanPicker loans={loans} email={profile.email} />;
}
