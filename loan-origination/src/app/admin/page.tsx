import { redirect } from "next/navigation";
import Link from "next/link";
import { getSessionProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export default async function AdminHome() {
  const session = await getSessionProfile();
  if (!session) redirect("/login");
  if (session.profile?.lender_user_type !== "admin") redirect("/");

  const supabase = await createClient();
  const { data: programs } = await supabase
    .from("loan_programs")
    .select("id,name,loan_type_key")
    .order("name");

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Admin · Loan Programs</h1>
          <p className="text-muted">Configure the AI intake per program</p>
        </div>
        <Link href="/" className="rounded-md border border-line px-4 py-2.5 font-medium">
          ← Pipeline
        </Link>
      </header>

      <ul className="flex flex-col gap-3">
        {(programs ?? []).map((p: { id: string; name: string }) => (
          <li key={p.id}>
            <Link
              href={`/admin/programs/${p.id}`}
              className="flex items-center justify-between rounded-md border border-line px-4 py-4 hover:bg-black/[0.02]"
            >
              <span className="font-medium">{p.name}</span>
              <span className="text-muted">Configure →</span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
