import { redirect } from "next/navigation";
import Link from "next/link";
import { getSessionProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app-shell";
import { navFor } from "@/lib/nav";
import { ProgramsAdmin, type ProgramRow } from "@/components/programs-admin";

export default async function AdminHome() {
  const session = await getSessionProfile();
  if (!session) redirect("/login");
  if (session.profile?.lender_user_type !== "admin") redirect("/");

  const supabase = await createClient();
  const { data: programs } = await supabase
    .from("loan_programs")
    .select("id,name,loan_type_key,asset_class,sort")
    .order("sort")
    .order("name");

  const nav = navFor(session.profile);

  const library = [
    { href: "/admin/intake-links", label: "Intake Links", hint: "Shareable Sphinx & white-label intake links" },
    { href: "/admin/program-config", label: "Program Configuration", hint: "Import fields, documents & tasks per program" },
    { href: "/admin/document-types", label: "Document Types", hint: "Shared library for checklists" },
    { href: "/admin/pricing", label: "DSCR Pricing", hint: "Upload Eastview & Deephaven sizers" },
    { href: "/admin/users", label: "Users & Roles", hint: "Lending team membership and roles" },
  ];

  return (
    <AppShell email={session.profile?.email ?? ""} nav={nav}>
      <main className="mx-auto max-w-5xl px-6 py-9 lg:px-10">
        <div className="mb-8">
          <h1 className="text-[1.75rem] font-bold text-fg">Settings</h1>
          <p className="mt-1 text-sm text-muted">Configure the AI intake, libraries, and your team.</p>
        </div>

        <section className="mb-10">
          <h2 className="mb-3 text-sm font-semibold text-fg">Library &amp; settings</h2>
          <div className="card overflow-hidden">
            {library.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="flex items-center justify-between gap-4 border-b border-line px-5 py-4 last:border-0 transition-colors hover:bg-surface-2/60"
              >
                <span className="font-semibold text-fg">{l.label}</span>
                <span className="flex items-center gap-2 text-sm text-muted">
                  {l.hint}
                  <span aria-hidden className="text-faint">→</span>
                </span>
              </Link>
            ))}
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-sm font-semibold text-fg">Loan programs</h2>
          <ProgramsAdmin programs={(programs ?? []) as ProgramRow[]} />
        </section>
      </main>
    </AppShell>
  );
}
