"use server";

import { getSessionProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { upsertFieldValue } from "@/lib/fields";
import type { Broker } from "@/lib/types";

async function requireLender() {
  const session = await getSessionProfile();
  return session?.profile?.is_lending_team ? session : null;
}

/** The broker directory — saved brokers plus any with a portal account. Lending team only. */
export async function listBrokers(): Promise<Broker[]> {
  if (!(await requireLender())) return [];
  const sb = await createClient();
  const { data } = await sb.from("brokers").select("id,name,email,phone,user_id").order("name");
  return (data ?? []).map((r) => ({
    id: r.id as string,
    name: (r.name as string | null) ?? "",
    email: (r.email as string | null) ?? "",
    phone: (r.phone as string | null) ?? "",
    userId: (r.user_id as string | null) ?? null,
  }));
}

/** Create or update a directory broker (name/email/phone). Lending team only. */
export async function saveBroker(input: {
  id?: string;
  name: string;
  email: string;
  phone: string;
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  const session = await requireLender();
  if (!session) return { ok: false, error: "Lending team only." };
  const sb = await createClient();
  const row = {
    name: input.name.trim() || null,
    email: input.email.trim() || null,
    phone: input.phone.trim() || null,
    updated_at: new Date().toISOString(),
  };
  if (input.id) {
    const { error } = await sb.from("brokers").update(row).eq("id", input.id);
    return error ? { ok: false, error: error.message } : { ok: true, id: input.id };
  }
  const { data, error } = await sb
    .from("brokers")
    .insert({ ...row, created_by: session.userId })
    .select("id")
    .single();
  return error || !data ? { ok: false, error: error?.message ?? "Couldn't save broker." } : { ok: true, id: data.id as string };
}

/** Delete a directory broker. Lending team only. */
export async function deleteBroker(id: string): Promise<{ ok: boolean; error?: string }> {
  if (!(await requireLender())) return { ok: false, error: "Lending team only." };
  const sb = await createClient();
  const { error } = await sb.from("brokers").delete().eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

/**
 * Attach a directory broker to a loan: copy its contact into the loan's broker fields (so it shows
 * on Loan Info / the People Broker contact) and, when the directory entry is a portal account,
 * link that broker as a 'broker' deal participant so the deal lands in their pipeline. Lending team.
 */
export async function setLoanBroker(loanId: string, brokerId: string): Promise<{ ok: boolean; error?: string }> {
  const session = await requireLender();
  if (!session) return { ok: false, error: "Lending team only." };
  const admin = createServiceRoleClient();
  const { data: b } = await admin
    .from("brokers")
    .select("name,email,phone,user_id")
    .eq("id", brokerId)
    .maybeSingle();
  if (!b) return { ok: false, error: "Broker not found." };

  const fields: [string, string][] = [
    ["broker_name", (b.name as string | null) ?? ""],
    ["broker_email", (b.email as string | null) ?? ""],
    ["broker_phone", (b.phone as string | null) ?? ""],
    ["source_channel", "broker"],
  ];
  await Promise.all(
    fields
      .filter(([, v]) => v)
      .map(([key, value]) => upsertFieldValue(admin, { loanId, key, valueKind: "initial", value })),
  );

  const userId = b.user_id as string | null;
  if (userId) {
    await admin
      .from("deal_participants")
      .upsert(
        { loan_id: loanId, user_id: userId, participant_role: "broker", added_by: session.userId },
        { onConflict: "loan_id,user_id", ignoreDuplicates: true },
      )
      .then(() => {}, () => {});
  }
  return { ok: true };
}
