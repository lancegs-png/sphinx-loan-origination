"use client";

import { useEffect, useState } from "react";
import { listGuarantors, listEntities, saveGuarantor, saveEntity } from "@/app/guarantors/actions";
import type { Entity, Guarantor } from "@/lib/types";

const guarName = (g: Guarantor) => [g.firstName, g.lastName].filter(Boolean).join(" ") || "(no name)";

/** Select one or more saved guarantors, or quick-create a new one (which also saves it to the
 *  library). Reports the selected guarantor ids. */
export function GuarantorPicker({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) {
  const [list, setList] = useState<Guarantor[]>([]);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ firstName: "", lastName: "", email: "", phone: "" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    listGuarantors().then(setList).catch(() => {});
  }, []);

  const byId = new Map(list.map((g) => [g.id, g] as const));
  const available = list.filter((g) => !value.includes(g.id));

  async function createNew() {
    if (!draft.firstName.trim() && !draft.lastName.trim()) {
      setAdding(false);
      return;
    }
    setBusy(true);
    const res = await saveGuarantor({ id: "", ssn: "", dateOfBirth: "", mailingAddress: "", ...draft });
    setBusy(false);
    if (res.ok && res.id) {
      setList((p) => [...p, { id: res.id!, ssn: "", dateOfBirth: "", mailingAddress: "", ...draft }]);
      onChange([...value, res.id]);
      setDraft({ firstName: "", lastName: "", email: "", phone: "" });
      setAdding(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((id) => (
            <span key={id} className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-xs text-fg">
              {byId.has(id) ? guarName(byId.get(id)!) : "Guarantor"}
              <button type="button" onClick={() => onChange(value.filter((x) => x !== id))} aria-label="Remove" className="text-faint hover:text-fg">×</button>
            </span>
          ))}
        </div>
      )}
      {!adding ? (
        <div className="flex gap-2">
          <select
            value=""
            onChange={(e) => e.target.value && onChange([...value, e.target.value])}
            className="field field-sm flex-1"
            aria-label="Add a saved guarantor"
          >
            <option value="">Select a saved guarantor…</option>
            {available.map((g) => (
              <option key={g.id} value={g.id}>{guarName(g)}{g.email ? ` · ${g.email}` : ""}</option>
            ))}
          </select>
          <button type="button" onClick={() => setAdding(true)} className="btn btn-secondary btn-sm shrink-0">+ New</button>
        </div>
      ) : (
        <div className="rounded-md border border-line p-2">
          <div className="grid grid-cols-2 gap-2">
            <input value={draft.firstName} onChange={(e) => setDraft((d) => ({ ...d, firstName: e.target.value }))} placeholder="First name" className="field field-sm" />
            <input value={draft.lastName} onChange={(e) => setDraft((d) => ({ ...d, lastName: e.target.value }))} placeholder="Last name" className="field field-sm" />
            <input value={draft.email} onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))} placeholder="Email" className="field field-sm" />
            <input value={draft.phone} onChange={(e) => setDraft((d) => ({ ...d, phone: e.target.value }))} placeholder="Phone" className="field field-sm" />
          </div>
          <div className="mt-2 flex justify-end gap-2">
            <button type="button" onClick={() => setAdding(false)} className="btn btn-ghost btn-sm">Cancel</button>
            <button type="button" onClick={createNew} disabled={busy} className="btn btn-primary btn-sm">{busy ? "Adding…" : "Add guarantor"}</button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Select a saved entity, or quick-create one (also saved to the library). Reports its id. */
export function EntityPicker({ value, onChange }: { value: string | null; onChange: (id: string | null) => void }) {
  const [list, setList] = useState<Entity[]>([]);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ name: "", ein: "" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    listEntities().then(setList).catch(() => {});
  }, []);

  async function createNew() {
    if (!draft.name.trim()) {
      setAdding(false);
      return;
    }
    setBusy(true);
    const res = await saveEntity({ id: "", name: draft.name, ein: draft.ein, mailingAddress: "", entityType: "", stateOfFormation: "", members: [] });
    setBusy(false);
    if (res.ok && res.id) {
      setList((p) => [...p, { id: res.id!, name: draft.name, ein: draft.ein, mailingAddress: "", entityType: "", stateOfFormation: "", members: [] }]);
      onChange(res.id);
      setDraft({ name: "", ein: "" });
      setAdding(false);
    }
  }

  if (adding) {
    return (
      <div className="rounded-md border border-line p-2">
        <div className="grid grid-cols-2 gap-2">
          <input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} placeholder="Entity name" className="field field-sm" />
          <input value={draft.ein} onChange={(e) => setDraft((d) => ({ ...d, ein: e.target.value }))} placeholder="EIN" className="field field-sm" />
        </div>
        <div className="mt-2 flex justify-end gap-2">
          <button type="button" onClick={() => setAdding(false)} className="btn btn-ghost btn-sm">Cancel</button>
          <button type="button" onClick={createNew} disabled={busy} className="btn btn-primary btn-sm">{busy ? "Adding…" : "Add entity"}</button>
        </div>
      </div>
    );
  }
  return (
    <div className="flex gap-2">
      <select value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} className="field field-sm flex-1" aria-label="Borrowing entity">
        <option value="">No entity / select…</option>
        {list.map((e) => (
          <option key={e.id} value={e.id}>{e.name}{e.ein ? ` · EIN ${e.ein}` : ""}</option>
        ))}
      </select>
      <button type="button" onClick={() => setAdding(true)} className="btn btn-secondary btn-sm shrink-0">+ New</button>
    </div>
  );
}
