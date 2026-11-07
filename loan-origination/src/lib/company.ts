import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// Company-wide config (app_settings, brief §7). Read once, shared by every template.
export type LenderConfig = { name: string; address: string; signer: string; signer_title: string };
export type ServicerInfo = { address?: string; phone?: string; website?: string };
export type NoteBuyerInfo = { entity?: string; address?: string };
export type CompanyConfig = {
  lender: LenderConfig;
  collateral_ship_to: string;
  seller: string;
  servicers: Record<string, ServicerInfo>;
  note_buyers: Record<string, NoteBuyerInfo>;
};

const DEFAULT_LENDER: LenderConfig = {
  name: "Sphinx Capital, LLC",
  address: "",
  signer: "",
  signer_title: "",
};

/**
 * Load company config from app_settings. Pass a service-role client: these values
 * (lender name/signer, servicer details) appear on borrower-facing documents, and
 * app_settings RLS is lending-team-only.
 */
export async function loadCompanyConfig(client: SupabaseClient): Promise<CompanyConfig> {
  const keys = ["lender", "collateral_ship_to", "seller", "servicers", "note_buyers"];
  const { data } = await client.from("app_settings").select("key,value").in("key", keys);
  const m = Object.fromEntries((data ?? []).map((r) => [r.key, r.value])) as Record<string, unknown>;
  return {
    lender: { ...DEFAULT_LENDER, ...((m.lender as Partial<LenderConfig>) ?? {}) },
    collateral_ship_to: (m.collateral_ship_to as string) ?? "",
    seller: (m.seller as string) ?? "",
    servicers: (m.servicers as Record<string, ServicerInfo>) ?? {},
    note_buyers: (m.note_buyers as Record<string, NoteBuyerInfo>) ?? {},
  };
}

/** A loan's note buyer: a per-loan override wins, else the default for its investor_name. */
export function resolveNoteBuyer(
  config: CompanyConfig,
  investorName: string | null | undefined,
  override?: { entity?: string | null; address?: string | null },
): { entity: string; address: string } {
  const def = investorName ? config.note_buyers[investorName] : undefined;
  return {
    entity: override?.entity || def?.entity || investorName || "",
    address: override?.address || def?.address || "",
  };
}
