"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { publishInvestorPricing } from "@/app/actions";
import { createClient } from "@/lib/supabase/client";
import type { GeneralConfig, InvestorFamily } from "@/lib/pricing/general";
import type { PricingPreview } from "@/lib/pricing/preview";

const BUCKET = "loan-documents";

type PublishedMeta = { effective: string | null; at: string; file: string | null } | undefined;

const INVESTORS: { family: InvestorFamily; name: string; hint: string }[] = [
  { family: "eastview", name: "Eastview", hint: "EV DSCR S Sizer — the Pricing & Lev Grid tabs" },
  { family: "deephaven", name: "Deephaven", hint: "Deephaven Pricer — the Investor NQM rate sheet" },
];

function pct(n: number | null | undefined) {
  return n == null ? "—" : `${(n * 100).toFixed(3)}%`;
}

export function PricingSizerUpload({
  published,
}: {
  published: Partial<Record<InvestorFamily, PublishedMeta>>;
}) {
  return (
    <div className="flex flex-col gap-5">
      {INVESTORS.map((inv) => (
        <InvestorCard key={inv.family} investor={inv} published={published[inv.family]} />
      ))}
    </div>
  );
}

function InvestorCard({
  investor,
  published,
}: {
  investor: { family: InvestorFamily; name: string; hint: string };
  published: PublishedMeta;
}) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<"idle" | "parsing" | "publishing">("idle");
  const [preview, setPreview] = useState<PricingPreview | null>(null);
  const [engine, setEngine] = useState<GeneralConfig | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function parse() {
    if (!file) return;
    setBusy("parsing");
    setErr(null);
    setMsg(null);
    setPreview(null);
    setEngine(null);
    try {
      // The sizer (Eastview is ~14MB) can't POST through the function — Vercel caps request
      // bodies at 4.5MB. Upload the bytes straight to Storage via a signed URL, then hand the
      // parse route just the storage path; it downloads + parses server-side and cleans up.
      const signRes = await fetch("/api/admin/pricing/sign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: file.name }),
      });
      const sign = await signRes.json();
      if (!sign.ok) {
        setErr(sign.error ?? "Could not start the upload.");
        setBusy("idle");
        return;
      }
      const supabase = createClient();
      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .uploadToSignedUrl(sign.path, sign.token, file, {
          contentType: file.type || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        });
      if (upErr) {
        setErr(`Upload failed: ${upErr.message}`);
        setBusy("idle");
        return;
      }
      const res = await fetch("/api/admin/pricing/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ investor: investor.family, storagePath: sign.path, fileName: file.name }),
      });
      const json = await res.json();
      if (!json.ok) setErr(json.error ?? "Could not parse the file.");
      else {
        setPreview(json.preview as PricingPreview);
        setEngine(json.engine as GeneralConfig);
      }
    } catch {
      setErr("Upload failed — is the file a valid .xlsx?");
    }
    setBusy("idle");
  }

  async function publish() {
    if (!engine) return;
    setBusy("publishing");
    setErr(null);
    const res = await publishInvestorPricing({ investor: investor.family, engine });
    setBusy("idle");
    if (!res.ok) setErr(res.error ?? "Publish failed.");
    else {
      setMsg(`Published — effective ${res.effectiveDate ?? "n/a"}. The Quote tab now uses it.`);
      setPreview(null);
      setEngine(null);
      setFile(null);
      router.refresh();
    }
  }

  return (
    <section className="card p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-fg">{investor.name}</h2>
          <p className="mt-0.5 text-sm text-muted">{investor.hint}</p>
        </div>
        <div className="text-right text-xs text-muted">
          {published ? (
            <>
              <div className="status-pill status-approved">Live</div>
              <div className="mt-1">Effective {published.effective ?? "n/a"}</div>
              <div>Updated {new Date(published.at).toLocaleDateString()}</div>
            </>
          ) : (
            <div className="status-pill status-outstanding">Not uploaded</div>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <input
          type="file"
          accept=".xlsx"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setPreview(null);
            setEngine(null);
            setErr(null);
            setMsg(null);
          }}
          className="text-sm text-muted file:mr-3 file:rounded-md file:border-0 file:bg-surface file:px-3 file:py-1.5 file:text-sm file:text-fg"
        />
        <button onClick={parse} disabled={!file || busy !== "idle"} className="btn btn-secondary text-sm">
          {busy === "parsing" ? "Parsing…" : "Parse & preview"}
        </button>
      </div>

      {err && <p className="mt-3 text-sm text-muted">{err}</p>}
      {msg && <p className="mt-3 text-sm text-fg">{msg}</p>}

      {preview && (
        <div className="mt-4 rounded-lg border border-line p-4">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-3">
            <Field label="Effective date" value={preview.effectiveDate ?? "—"} />
            {preview.tier && <Field label="Tier" value={preview.tier} />}
            <Field label="Source file" value={preview.sourceFile ?? "—"} />
            <Field
              label="Rate range"
              value={preview.rateRange ? `${pct(preview.rateRange.low)} – ${pct(preview.rateRange.high)}` : "—"}
            />
            <Field
              label="Price range"
              value={preview.priceRange ? `${preview.priceRange.low.toFixed(3)} – ${preview.priceRange.high.toFixed(3)}` : "—"}
            />
            <Field label="Min price (floor)" value={preview.minPrice.toFixed(3)} />
            <Field label="Loan size" value={`$${preview.minLoan.toLocaleString()} – $${preview.maxLoan.toLocaleString()}`} />
            <Field
              label="Leverage"
              value={preview.leverageRows ? `${preview.leverageRows} rows` : `${preview.eligibilityTiers} tiers`}
            />
            <Field label="Adjustment grids" value={Object.entries(preview.gridRows).map(([k, v]) => `${k}:${v}`).join("  ")} />
          </div>

          {preview.warnings.length > 0 && (
            <ul className="mt-3 list-disc pl-5 text-sm text-muted">
              {preview.warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          )}

          <div className="mt-4 flex items-center gap-3">
            <button onClick={publish} disabled={busy !== "idle"} className="btn btn-primary text-sm">
              {busy === "publishing" ? "Publishing…" : `Publish ${investor.name} pricing`}
            </button>
            <span className="text-xs text-muted">Review the numbers above, then publish to make it live on the Quote tab.</span>
          </div>
        </div>
      )}
    </section>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted">{label}</div>
      <div className="font-medium text-fg">{value}</div>
    </div>
  );
}
