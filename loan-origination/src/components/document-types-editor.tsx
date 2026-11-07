"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { saveDocumentType, deleteDocumentType } from "@/app/actions";

export type DocType = {
  id: string;
  name: string;
  default_naming_convention: string | null;
  default_review_rules: string | null;
};

export function DocumentTypesEditor({ initial }: { initial: DocType[] }) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);

  // New-type form
  const [name, setName] = useState("");
  const [naming, setNaming] = useState("");
  const [rules, setRules] = useState("");
  const [busy, setBusy] = useState(false);

  async function add() {
    if (!name.trim()) return;
    setBusy(true);
    const res = await saveDocumentType({
      key: "",
      name,
      defaultNaming: naming,
      defaultReviewRules: rules,
    });
    setBusy(false);
    if (!res.ok) return setMsg(res.error ?? "Save failed.");
    setName("");
    setNaming("");
    setRules("");
    setMsg("Added.");
    router.refresh();
  }

  async function remove(id: string) {
    const res = await deleteDocumentType(id);
    if (!res.ok) return setMsg(res.error ?? "Delete failed.");
    router.refresh();
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-9 lg:px-10">
      <Link href="/admin" className="text-sm text-muted transition-colors hover:text-fg">
        ← Settings
      </Link>
      <header className="mb-8 mt-3">
        <h1 className="text-[1.75rem] font-bold text-fg">Document Types</h1>
        <p className="mt-1 text-sm text-muted">The shared library programs build their checklists from.</p>
      </header>

      <ul className="mb-10 flex flex-col gap-3">
        {initial.length === 0 && (
          <li className="card grid place-items-center px-6 py-14 text-center text-sm text-muted">
            No document types yet.
          </li>
        )}
        {initial.map((d) => (
          <DocTypeRow key={d.id} doc={d} onSaved={() => router.refresh()} onRemove={() => remove(d.id)} />
        ))}
      </ul>

      <section className="card p-5">
        <h2 className="mb-4 text-lg font-semibold text-fg">Add a document type</h2>
        <div className="flex flex-col gap-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name (e.g. Bank Statements)"
            className="field w-full"
          />
          <input
            value={naming}
            onChange={(e) => setNaming(e.target.value)}
            placeholder="Default file naming (optional, e.g. {LoanNumber} Bank Statements)"
            className="field w-full"
          />
          <textarea
            value={rules}
            onChange={(e) => setRules(e.target.value)}
            rows={3}
            placeholder="Default AI review rules (optional) — what to check on this document"
            className="field w-full resize-y"
          />
          <button onClick={add} disabled={busy} className="btn btn-primary self-start">
            {busy ? "Adding…" : "Add"}
          </button>
        </div>
      </section>

      {msg && <p className="mt-4 text-sm text-muted">{msg}</p>}
    </main>
  );
}

function DocTypeRow({
  doc,
  onSaved,
  onRemove,
}: {
  doc: DocType;
  onSaved: () => void;
  onRemove: () => void;
}) {
  const [name, setName] = useState(doc.name);
  const [naming, setNaming] = useState(doc.default_naming_convention ?? "");
  const [rules, setRules] = useState(doc.default_review_rules ?? "");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    await saveDocumentType({
      id: doc.id,
      key: "",
      name,
      defaultNaming: naming,
      defaultReviewRules: rules,
    });
    setBusy(false);
    onSaved();
  }

  return (
    <li className="card flex flex-col gap-2 p-4">
      <div className="flex items-center gap-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="field w-full flex-1 font-medium"
        />
        <button onClick={onRemove} className="btn btn-ghost text-sm text-[var(--status-outstanding)]">
          Remove
        </button>
      </div>
      <input
        value={naming}
        onChange={(e) => setNaming(e.target.value)}
        placeholder="Default file naming"
        className="field w-full"
      />
      <textarea
        value={rules}
        onChange={(e) => setRules(e.target.value)}
        rows={2}
        placeholder="Default AI review rules"
        className="field w-full resize-y"
      />
      <button onClick={save} disabled={busy} className="btn btn-secondary self-start text-sm">
        {busy ? "Saving…" : "Save"}
      </button>
    </li>
  );
}
