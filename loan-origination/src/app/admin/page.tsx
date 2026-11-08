import { redirect } from "next/navigation";
import Link from "next/link";
import { getSessionProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app-shell";
import { navFor } from "@/lib/nav";

export default async function AdminHome() {
  const session = await getSessionProfile();
  if (!session) redirect("/login");
  if (session.profile?.lender_user_type !== "admin") redirect("/");

  const supabase = await createClient();
  const { data: programs } = await supabase
    .from("loan_programs")
    .select("id,name,loan_type_key")
    .order("name");

  const nav = navFor(session.profile);

  const library = [
    { href: "/admin/intake", label: "Global Intake", hint: "Opening questions, style, examples" },
    { href: "/admin/document-types", label: "Document Types", hint: "Shared library for checklists" },
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
          {(programs ?? []).length === 0 ? (
            <div className="card grid place-items-center px-6 py-14 text-center">
              <p className="text-sm text-muted">No loan programs yet.</p>
            </div>
          ) : (
            <div className="card overflow-hidden">
              {(programs ?? []).map((p: { id: string; name: string }) => (
                <Link
                  key={p.id}
                  href={`/admin/programs/${p.id}`}
                  className="flex items-center justify-between gap-4 border-b border-line px-5 py-4 last:border-0 transition-colors hover:bg-surface-2/60"
                >
                  <span className="font-semibold text-fg">{p.name}</span>
                  <span className="flex items-center gap-2 text-sm text-muted">
                    Configure
                    <span aria-hidden className="text-faint">→</span>
                  </span>
                </Link>
              ))}
            </div>
          )}
        </section>
      </main>
    </AppShell>
  );
}
