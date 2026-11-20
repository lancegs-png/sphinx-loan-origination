"use server";

import { getSessionProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { copyEntityToLoan, copyGuarantorToLoan, loadEntities, loadGuarantors } from "@/lib/parties";
import type { Entity, Guarantor } from "@/lib/types";

async function requireLender() {
  const session = await getSessionProfile();
  return session?.profile?.is_lending_team ? session : null;
}

export async function listGuarantors(): Promise<Guarantor[]> {
  if (!(await requireLender())) return [];
  return loadGuarantors(await createClient());
}

export async function listEntities(): Promise<Entity[]> {
  if (!(await requireLender())) return [];
  return loadEntities(await createClient());
}

export async function saveGuarantor(input: Guarantor): Promise<{ ok: boolean; id?: string; error?: string }> {
  const session = await requireLender();
  if (!session) return { ok: false, error: "Lending team only." };
  const sb = await createClient();
  const row = {
    first_name: input.firstName.trim() || null,
    last_name: input.lastName.trim() || null,
    email: input.email.trim() || null,
    phone: input.phone.trim() || null,
    ssn: input.ssn.trim() || null,
    date_of_birth: input.dateOfBirth.trim() || null,
    mailing_address: input.mailingAddress.trim() || null,
    updated_at: new Date().toISOString(),
  };
  if (input.id) {
    const { error } = await sb.from("guarantors").update(row).eq("id", input.id);
    if (error) return { ok: false, error: error.message };
    return { ok: true, id: input.id };
  }
  const { data, error } = await sb
    .from("guarantors")
    .insert({ ...row, created_by: session.userId })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, id: data.id as string };
}

export async function deleteGuarantor(id: string): Promise<{ ok: boolean; error?: string }> {
  if (!(await requireLender())) return { ok: false, error: "Lending team only." };
  const sb = await createClient();
  const { error } = await sb.from("guarantors").delete().eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function saveEntity(input: Entity): Promise<{ ok: boolean; id?: string; error?: string }> {
  const session = await requireLender();
  if (!session) return { ok: false, error: "Lending team only." };
  const sb = await createClient();
  const row = {
    name: input.name.trim() || "Unnamed entity",
    ein: input.ein.trim() || null,
    mailing_address: input.mailingAddress.trim() || null,
    entity_type: input.entityType.trim() || null,
    state_of_formation: input.stateOfFormation.trim() || null,
    updated_at: new Date().toISOString(),
  };
  let entityId = input.id;
  if (entityId) {
    const { error } = await sb.from("entities").update(row).eq("id", entityId);
    if (error) return { ok: false, error: error.message };
  } else {
    const { data, error } = await sb
      .from("entities")
      .insert({ ...row, created_by: session.userId })
      .select("id")
      .single();
    if (error) return { ok: false, error: error.message };
    entityId = data.id as string;
  }
  // Members: replace the set (no per-loan state hangs off them).
  await sb.from("entity_members").delete().eq("entity_id", entityId);
  const members = input.members
    .filter((m) => m.name.trim() || m.guarantorId)
    .map((m, i) => ({
      entity_id: entityId,
      name: m.name.trim() || null,
      ownership_pct: m.ownershipPct.trim() ? Number(m.ownershipPct.replace(/[^0-9.]/g, "")) : null,
      guarantor_id: m.guarantorId || null,
      sort: i,
    }));
  if (members.length) {
    const { error } = await sb.from("entity_members").insert(members);
    if (error) return { ok: false, error: error.message };
  }
  return { ok: true, id: entityId };
}

export async function deleteEntity(id: string): Promise<{ ok: boolean; error?: string }> {
  if (!(await requireLender())) return { ok: false, error: "Lending team only." };
  const sb = await createClient();
  const { error } = await sb.from("entities").delete().eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** Pull a saved guarantor onto an existing loan at the next free guarantor slot. */
export async function addLoanGuarantor(loanId: string, guarantorId: string): Promise<{ ok: boolean; error?: string; idx?: number }> {
  if (!(await requireLender())) return { ok: false, error: "Lending team only." };
  const sb = await createClient();
  const { data: rows } = await sb
    .from("loan_field_values")
    .select("idx")
    .eq("loan_id", loanId)
    .eq("field_key", "guarantor_first_name");
  const nextIdx = (rows ?? []).reduce((m, r) => Math.max(m, Number(r.idx)), 0) + 1;
  const guar = (await loadGuarantors(sb)).find((g) => g.id === guarantorId);
  if (!guar) return { ok: false, error: "Guarantor not found." };
  await copyGuarantorToLoan(sb, loanId, guar, nextIdx);
  return { ok: true, idx: nextIdx };
}

/** Set (or replace) an existing loan's borrowing entity from a saved record. */
export async function setLoanEntity(loanId: string, entityId: string): Promise<{ ok: boolean; error?: string }> {
  if (!(await requireLender())) return { ok: false, error: "Lending team only." };
  const sb = await createClient();
  const ent = (await loadEntities(sb)).find((e) => e.id === entityId);
  if (!ent) return { ok: false, error: "Entity not found." };
  await copyEntityToLoan(sb, loanId, ent);
  return { ok: true };
}
