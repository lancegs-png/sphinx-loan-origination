import type { Metadata } from "next";
import { getActiveApplicationLink } from "@/lib/application/links";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { loadFieldValues } from "@/lib/fields";
import { PublicApplicationForm } from "@/components/public-application-form";
import type { FieldValues } from "@/lib/types";

export async function generateMetadata(): Promise<Metadata> {
  return { title: "Loan Application — Sphinx Capital" };
}

/**
 * Build the form's prefill from the loan's current field values. idx-1 values map to their key;
 * a guarantor row #2 maps to the co-guarantor (`cog_*`) keys and reveals that block. Other repeats
 * (additional properties, etc.) are left to the snapshot/later phases.
 */
function buildInitialValues(fv: FieldValues): Record<string, string> {
  const out: Record<string, string> = {};
  let hasCoguarantor = false;
  for (const [k, cell] of Object.entries(fv)) {
    const cur = cell?.current;
    if (cur === null || cur === undefined || cur === "") continue;
    const s = String(cur);
    const hash = k.indexOf("#");
    if (hash === -1) {
      out[k] = s;
    } else {
      const base = k.slice(0, hash);
      const idx = k.slice(hash + 1);
      if (idx === "2" && base.startsWith("guarantor_")) {
        out[`cog_${base}`] = s;
        hasCoguarantor = true;
      }
    }
  }
  if (hasCoguarantor) out.has_coguarantor = "Yes";
  return out;
}

/**
 * Public, no-login borrower Loan Application (post-term-sheet). Resolves the per-loan link by token
 * through the service role, prefills from the loan's current field values, and renders the form.
 */
export default async function ApplicationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const link = await getActiveApplicationLink(token);

  if (!link) {
    return (
      <div className="grid min-h-screen place-items-center bg-surface-2 px-4">
        <div className="card max-w-md p-8 text-center">
          <h1 className="text-lg font-bold text-fg">This link is no longer available</h1>
          <p className="mt-2 text-sm text-muted">
            The application link you followed is inactive, already completed, or invalid. Please request a
            current link.
          </p>
        </div>
      </div>
    );
  }

  const admin = createServiceRoleClient();
  const fieldValues = await loadFieldValues(admin, link.loan_id);
  const initialValues = buildInitialValues(fieldValues);

  return <PublicApplicationForm token={link.token} initialValues={initialValues} />;
}
