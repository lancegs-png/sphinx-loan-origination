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
    <main className="mx-auto max-w-3xl px-6 py-10">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Document Types</h1>
          <p className="text-muted">The shared library programs build their checklists from.</p>
        </div>
        <Link href="/admin" className="rounded-md border border-line px-4 py-2.5 font-medium">
          ← Admin
        </Link>
      </header>

      <ul className="mb-10 flex flex-col gap-3">
        {initial.length === 0 && <li className="text-muted">No document types yet.</li>}
        {initial.map((d) => (
          <DocTypeRow key={d.id} doc={d} onSaved={() => router.refresh()} onRemove={() => remove(d.id)} />
        ))}
      </ul>

      <section className="rounded-md border border-line p-5">
        <h2 className="mb-4 text-lg font-semibold">Add a document type</h2>
        <div className="flex flex-col gap-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name (e.g. Bank Statements)"
            className="rounded-md border border-line px-3 py-2.5 text-base"
          />
          <input
            value={naming}
            onChange={(e) => setNaming(e.target.value)}
            placeholder="Default file naming (optional, e.g. {LoanNumber} Bank Statements)"
            className="rounded-md border border-line px-3 py-2.5 text-base"
          />
          <textarea
            value={rules}
            onChange={(e) => setRules(e.target.value)}
            rows={3}
            placeholder="Default AI review rules (optional) — what to check on this document"
            className="resize-y rounded-md border border-line px-3 py-2.5 text-base"
          />
          <button
            onClick={add}
            disabled={busy}
            className="self-start rounded-md bg-fg px-5 py-2.5 font-medium text-white disabled:opacity-50"
          >
            {busy ? "Adding…" : "Add"}
          </button>
        </div>
      </section>

      {msg && <p className="mt-4 text-sm">{msg}</p>}
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
    <li className="flex flex-col gap-2 rounded-md border border-line p-4">
      <div className="flex items-center justify-between">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="flex-1 rounded-md border border-line px-3 py-2 text-base font-medium"
        />
        <button onClick={onRemove} className="ml-3 text-sm text-muted underline">
          remove
        </button>
      </div>
      <input
        value={naming}
        onChange={(e) => setNaming(e.target.value)}
        placeholder="Default file naming"
        className="rounded-md border border-line px-3 py-2 text-sm"
      />
      <textarea
        value={rules}
        onChange={(e) => setRules(e.target.value)}
        rows={2}
        placeholder="Default AI review rules"
        className="resize-y rounded-md border border-line px-3 py-2 text-sm"
      />
      <button
        onClick={save}
        disabled={busy}
        className="self-start rounded-md border border-line px-4 py-2 text-sm font-medium disabled:opacity-50"
      >
        {busy ? "Saving…" : "Save"}
      </button>
    </li>
  );
}
