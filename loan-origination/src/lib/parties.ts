import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { upsertFieldValue } from "@/lib/fields";
import type { Entity, EntityMember, Guarantor } from "@/lib/types";

type Row = Record<string, unknown>;
const s = (v: unknown): string => (v == null ? "" : String(v));

function toGuarantor(r: Row): Guarantor {
  return {
    id: s(r.id),
    firstName: s(r.first_name),
    lastName: s(r.last_name),
    email: s(r.email),
    phone: s(r.phone),
    ssn: s(r.ssn),
    dateOfBirth: s(r.date_of_birth),
    mailingAddress: s(r.mailing_address),
  };
}

/** All saved guarantors (lending-team only, via RLS). */
export async function loadGuarantors(client: SupabaseClient): Promise<Guarantor[]> {
  const { data } = await client
    .from("guarantors")
    .select("id,first_name,last_name,email,phone,ssn,date_of_birth,mailing_address")
    .order("last_name")
    .order("first_name");
  return ((data as Row[]) ?? []).map(toGuarantor);
}

/** All saved entities with their members (lending-team only, via RLS). */
export async function loadEntities(client: SupabaseClient): Promise<Entity[]> {
  const { data: ents } = await client
    .from("entities")
    .select("id,name,ein,mailing_address,entity_type,state_of_formation")
    .order("name");
  const rows = (ents as Row[]) ?? [];
  const ids = rows.map((e) => s(e.id));
  const { data: mem } = ids.length
    ? await client
        .from("entity_members")
        .select("id,entity_id,name,ownership_pct,guarantor_id,sort")
        .in("entity_id", ids)
        .order("sort")
    : { data: [] as Row[] };
  const byEntity = new Map<string, EntityMember[]>();
  for (const m of (mem as Row[]) ?? []) {
    const arr = byEntity.get(s(m.entity_id)) ?? [];
    arr.push({
      id: s(m.id),
      name: s(m.name),
      ownershipPct: m.ownership_pct == null ? "" : String(m.ownership_pct),
      guarantorId: m.guarantor_id ? s(m.guarantor_id) : null,
    });
    byEntity.set(s(m.entity_id), arr);
  }
  return rows.map((e) => ({
    id: s(e.id),
    name: s(e.name),
    ein: s(e.ein),
    mailingAddress: s(e.mailing_address),
    entityType: s(e.entity_type),
    stateOfFormation: s(e.state_of_formation),
    members: byEntity.get(s(e.id)) ?? [],
  }));
}

// guarantor property -> loan dictionary key
const GUAR_FIELD_MAP: [keyof Guarantor, string][] = [
  ["firstName", "guarantor_first_name"],
  ["lastName", "guarantor_last_name"],
  ["email", "guarantor_email"],
  ["phone", "guarantor_phone"],
  ["ssn", "guarantor_ssn"],
  ["dateOfBirth", "guarantor_date_of_birth"],
  ["mailingAddress", "guarantor_mailing_address"],
];

/** Snapshot a guarantor's data into a loan's field store at the given repeat idx, and record
 *  the provenance link. Independent copy — the library record is not touched afterwards. */
export async function copyGuarantorToLoan(
  admin: SupabaseClient,
  loanId: string,
  g: Guarantor,
  idx: number,
): Promise<void> {
  for (const [prop, key] of GUAR_FIELD_MAP) {
    const value = String(g[prop] ?? "").trim();
    if (value) await upsertFieldValue(admin, { loanId, key, idx, valueKind: "initial", value });
  }
  if (g.id) {
    await admin.from("loan_guarantors").upsert({ loan_id: loanId, guarantor_id: g.id, idx }, { onConflict: "loan_id,idx" });
  }
}

/** Load selected guarantors (in order) + the entity by id and snapshot them onto a loan.
 *  Guarantors land at idx 1..N. Uses a privileged client (called during loan creation). */
export async function copyPartiesToLoan(
  admin: SupabaseClient,
  loanId: string,
  guarantorIds: string[],
  entityId: string | null,
): Promise<void> {
  let idx = 1;
  for (const gid of guarantorIds) {
    if (!gid) continue;
    const { data } = await admin
      .from("guarantors")
      .select("id,first_name,last_name,email,phone,ssn,date_of_birth,mailing_address")
      .eq("id", gid)
      .maybeSingle();
    if (data) {
      await copyGuarantorToLoan(admin, loanId, toGuarantor(data as Row), idx);
      idx += 1;
    }
  }
  if (entityId) {
    const { data: e } = await admin
      .from("entities")
      .select("id,name,ein,mailing_address,entity_type,state_of_formation")
      .eq("id", entityId)
      .maybeSingle();
    if (e) {
      const r = e as Row;
      await copyEntityToLoan(admin, loanId, {
        id: s(r.id),
        name: s(r.name),
        ein: s(r.ein),
        mailingAddress: s(r.mailing_address),
        entityType: s(r.entity_type),
        stateOfFormation: s(r.state_of_formation),
        members: [],
      });
    }
  }
}

/** Snapshot an entity's data into a loan's field store, and record the provenance link. */
export async function copyEntityToLoan(admin: SupabaseClient, loanId: string, e: Entity): Promise<void> {
  const map: [string, string][] = [
    ["borrower_entity", e.name],
    ["entity_ein", e.ein],
    ["entity_mailing_address", e.mailingAddress],
    ["entity_type", e.entityType],
    ["entity_state", e.stateOfFormation],
  ];
  for (const [key, value] of map) {
    const v = String(value ?? "").trim();
    if (v) await upsertFieldValue(admin, { loanId, key, valueKind: "initial", value: v });
  }
  if (e.id) {
    await admin.from("loan_entities").upsert({ loan_id: loanId, entity_id: e.id }, { onConflict: "loan_id" });
  }
}
