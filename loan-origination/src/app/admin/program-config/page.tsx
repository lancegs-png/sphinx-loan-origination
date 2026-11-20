import { redirect } from "next/navigation";
import Link from "next/link";
import { getSessionProfile } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { navFor } from "@/lib/nav";
import { ProgramConfigImport } from "@/components/program-config-import";
import { LOAN_DATA_TAB, DOCUMENTS_TAB, TASKS_TAB } from "@/lib/program-config/contract";

export default async function ProgramConfigPage() {
  const session = await getSessionProfile();
  if (!session) redirect("/login");
  if (session.profile?.lender_user_type !== "admin") redirect("/");

  const nav = navFor(session.profile);

  return (
    <AppShell email={session.profile?.email ?? ""} nav={nav}>
      <main className="mx-auto max-w-5xl px-6 py-9 lg:px-10">
        <Link href="/admin" className="text-sm text-muted transition-colors hover:text-fg">
          ← Settings
        </Link>
        <header className="mb-6 mt-3">
          <h1 className="text-[1.75rem] font-bold text-fg">Program configuration</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Upload the exported Program Configuration spreadsheet to set, per program, which data fields, documents,
            and checklist tasks apply. The sheet is the source of truth — importing overwrites each program&apos;s set
            from the toggles. Tabs read: <span className="font-medium text-fg">{LOAN_DATA_TAB}</span>,{" "}
            <span className="font-medium text-fg">{DOCUMENTS_TAB}</span>,{" "}
            <span className="font-medium text-fg">{TASKS_TAB}</span>.
          </p>
        </header>

        <ProgramConfigImport />
      </main>
    </AppShell>
  );
}
