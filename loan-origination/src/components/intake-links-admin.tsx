"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { saveIntakeLink, setIntakeLinkActive, deleteIntakeLink } from "@/app/actions";
import type { IntakeLink, IntakeLinkOwnerType, IntakeLinkBranding } from "@/lib/intake/links";

type UserOpt = { id: string; full_name: string | null; email: string };

const OWNER_LABEL: Record<IntakeLinkOwnerType, string> = {
  sphinx_originator: "Sphinx originator",
  broker: "Broker",
  referral_partner: "Referral partner",
};

const BLANK = {
  id: undefined as string | undefined,
  label: "",
  owner_type: "sphinx_originator" as IntakeLinkOwnerType,
  owner_user_id: "" as string,
  owner_name: "",
  owner_email: "",
  branding: "sphinx" as IntakeLinkBranding,
};

export function IntakeLinksAdmin({
  links,
  counts,
  users,
}: {
  links: IntakeLink[];
  counts: Record<string, number>;
  users: UserOpt[];
}) {
  const router = useRouter();
  const [origin, setOrigin] = useState("");
  const [form, setForm] = useState<typeof BLANK | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOrigin(window.location.origin);
  }, []);

  const userName = useMemo(() => {
    const m: Record<string, string> = {};
    for (const u of users) m[u.id] = u.full_name || u.email;
    return m;
  }, [users]);

  function urlFor(token: string) {
    return `${origin || ""}/apply/${token}`;
  }

  async function copy(token: string) {
    try {
      await navigator.clipboard.writeText(urlFor(token));
      setCopied(token);
      setTimeout(() => setCopied((c) => (c === token ? null : c)), 1500);
    } catch {
      /* clipboard blocked — the field is selectable */
    }
  }

  async function save() {
    if (!form) return;
    setBusy(true);
    setError(null);
    const res = await saveIntakeLink({
      id: form.id,
      label: form.label,
      owner_type: form.owner_type,
      owner_user_id: form.owner_user_id || null,
      owner_name: form.owner_name || null,
      owner_email: form.owner_email || null,
      branding: form.branding,
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? "Could not save the link.");
      return;
    }
    setForm(null);
    router.refresh();
  }

  async function toggle(link: IntakeLink) {
    await setIntakeLinkActive(link.id, !link.active);
    router.refresh();
  }

  async function remove(link: IntakeLink) {
    if (!confirm(`Delete the link "${link.label}"? Existing deals it created are kept.`)) return;
    await deleteIntakeLink(link.id);
    router.refresh();
  }

  const isSphinx = form?.owner_type === "sphinx_originator";

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[1.75rem] font-bold text-fg">Intake Links</h1>
          <p className="mt-1 text-sm text-muted">
            Shareable links to the intake form. Each opens an Opportunity attributed to its owner. Sphinx-branded or
            white-label (no Sphinx identity) for brokers and partners.
          </p>
        </div>
        {!form && (
          <button type="button" className="btn btn-primary btn-sm shrink-0" onClick={() => setForm({ ...BLANK })}>
            + New link
          </button>
        )}
      </div>

      {form && (
        <div className="card mb-6 p-5">
          <h2 className="text-sm font-semibold text-fg">{form.id ? "Edit link" : "New link"}</h2>
          <div className="mt-4 grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 sm:col-span-2">
              <span className="text-xs font-medium text-muted">Label (internal name)</span>
              <input
                className="field"
                value={form.label}
                placeholder="e.g. Acme Brokers — Jane Doe"
                onChange={(e) => setForm({ ...form, label: e.target.value })}
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted">Owner type</span>
              <select
                className="field"
                value={form.owner_type}
                onChange={(e) => setForm({ ...form, owner_type: e.target.value as IntakeLinkOwnerType })}
              >
                <option value="sphinx_originator">Sphinx originator</option>
                <option value="broker">Broker</option>
                <option value="referral_partner">Referral partner</option>
              </select>
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted">Branding</span>
              <select
                className="field"
                value={form.branding}
                onChange={(e) => setForm({ ...form, branding: e.target.value as IntakeLinkBranding })}
              >
                <option value="sphinx">Sphinx-branded</option>
                <option value="white_label">White-label (no Sphinx)</option>
              </select>
            </label>

            {isSphinx ? (
              <label className="flex flex-col gap-1 sm:col-span-2">
                <span className="text-xs font-medium text-muted">Sphinx originator</span>
                <select
                  className="field"
                  value={form.owner_user_id}
                  onChange={(e) => setForm({ ...form, owner_user_id: e.target.value })}
                >
                  <option value="">Select…</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.full_name || u.email}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-muted">Partner name</span>
                  <input
                    className="field"
                    value={form.owner_name}
                    onChange={(e) => setForm({ ...form, owner_name: e.target.value })}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-muted">Partner email</span>
                  <input
                    className="field"
                    type="email"
                    value={form.owner_email}
                    onChange={(e) => setForm({ ...form, owner_email: e.target.value })}
                  />
                </label>
              </>
            )}
          </div>

          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

          <div className="mt-4 flex items-center justify-end gap-2">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setForm(null)} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={save} disabled={busy}>
              {busy ? "Saving…" : form.id ? "Save" : "Create link"}
            </button>
          </div>
        </div>
      )}

      <div className="card overflow-hidden">
        {links.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted">No intake links yet. Create one to start sharing.</p>
        ) : (
          links.map((link) => (
            <div key={link.id} className="flex flex-col gap-2 border-b border-line px-5 py-4 last:border-0">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-semibold text-fg">{link.label}</span>
                <span className="status-pill status-update">{OWNER_LABEL[link.owner_type]}</span>
                <span className="text-xs text-muted">
                  {link.branding === "white_label" ? "White-label" : "Sphinx-branded"}
                </span>
                {!link.active && <span className="status-pill status-outstanding">Inactive</span>}
                <span className="ml-auto text-xs text-faint">
                  {(counts[link.id] ?? 0)} submission{(counts[link.id] ?? 0) === 1 ? "" : "s"}
                </span>
              </div>

              <div className="text-xs text-muted">
                {link.owner_type === "sphinx_originator"
                  ? userName[link.owner_user_id ?? ""] ?? "—"
                  : [link.owner_name, link.owner_email].filter(Boolean).join(" · ") || "—"}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <input readOnly value={urlFor(link.token)} className="field flex-1 min-w-0 text-xs" onFocus={(e) => e.currentTarget.select()} />
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => copy(link.token)}>
                  {copied === link.token ? "Copied" : "Copy"}
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setForm({ id: link.id, label: link.label, owner_type: link.owner_type, owner_user_id: link.owner_user_id ?? "", owner_name: link.owner_name ?? "", owner_email: link.owner_email ?? "", branding: link.branding })}>
                  Edit
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => toggle(link)}>
                  {link.active ? "Deactivate" : "Activate"}
                </button>
                <button type="button" className="btn btn-ghost btn-sm text-red-600" onClick={() => remove(link)}>
                  Delete
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
