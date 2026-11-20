"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  saveGuarantor,
  deleteGuarantor,
  saveEntity,
  deleteEntity,
} from "@/app/guarantors/actions";
import type { Entity, EntityMember, Guarantor } from "@/lib/types";

const EMPTY_GUAR: Guarantor = {
  id: "",
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  ssn: "",
  dateOfBirth: "",
  mailingAddress: "",
};
const EMPTY_ENTITY: Entity = {
  id: "",
  name: "",
  ein: "",
  mailingAddress: "",
  entityType: "",
  stateOfFormation: "",
  members: [],
};

const guarName = (g: Guarantor) => [g.firstName, g.lastName].filter(Boolean).join(" ") || "(no name)";

export function PartiesManager({
  guarantors: initialGuarantors,
  entities: initialEntities,
}: {
  guarantors: Guarantor[];
  entities: Entity[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"guarantors" | "entities">("guarantors");
  const [guarantors, setGuarantors] = useState(initialGuarantors);
  const [entities, setEntities] = useState(initialEntities);
  const [editGuar, setEditGuar] = useState<Guarantor | null>(null);
  const [editEntity, setEditEntity] = useState<Entity | null>(null);
  const [query, setQuery] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  async function onSaveGuar(g: Guarantor) {
    const res = await saveGuarantor(g);
    if (!res.ok) return setMsg(res.error ?? "Save failed.");
    setEditGuar(null);
    setMsg(null);
    router.refresh();
    const saved = { ...g, id: res.id ?? g.id };
    setGuarantors((prev) => {
      const i = prev.findIndex((x) => x.id === saved.id);
      return i >= 0 ? prev.map((x) => (x.id === saved.id ? saved : x)) : [...prev, saved];
    });
  }
  async function onDeleteGuar(id: string) {
    const res = await deleteGuarantor(id);
    if (!res.ok) return setMsg(res.error ?? "Delete failed.");
    setGuarantors((prev) => prev.filter((x) => x.id !== id));
    router.refresh();
  }
  async function onSaveEntity(e: Entity) {
    const res = await saveEntity(e);
    if (!res.ok) return setMsg(res.error ?? "Save failed.");
    setEditEntity(null);
    setMsg(null);
    router.refresh();
    const saved = { ...e, id: res.id ?? e.id };
    setEntities((prev) => {
      const i = prev.findIndex((x) => x.id === saved.id);
      return i >= 0 ? prev.map((x) => (x.id === saved.id ? saved : x)) : [...prev, saved];
    });
  }
  async function onDeleteEntity(id: string) {
    const res = await deleteEntity(id);
    if (!res.ok) return setMsg(res.error ?? "Delete failed.");
    setEntities((prev) => prev.filter((x) => x.id !== id));
    router.refresh();
  }

  const q = query.trim().toLowerCase();
  const guarList = q
    ? guarantors.filter((g) => `${guarName(g)} ${g.email}`.toLowerCase().includes(q))
    : guarantors;
  const entityList = q ? entities.filter((e) => `${e.name} ${e.ein}`.toLowerCase().includes(q)) : entities;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-md border border-line p-0.5 text-sm">
          {(["guarantors", "entities"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded px-3 py-1 font-medium capitalize ${tab === t ? "bg-surface-2 text-fg" : "text-muted hover:text-fg"}`}
            >
              {t}
            </button>
          ))}
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search…"
          className="field field-sm w-48"
        />
        <button
          onClick={() => (tab === "guarantors" ? setEditGuar({ ...EMPTY_GUAR }) : setEditEntity({ ...EMPTY_ENTITY }))}
          className="btn btn-primary btn-sm ml-auto"
        >
          + New {tab === "guarantors" ? "guarantor" : "entity"}
        </button>
      </div>

      {msg && <p className="text-sm text-red-600">{msg}</p>}

      {tab === "guarantors" ? (
        <div className="card divide-y divide-line">
          {guarList.length === 0 && <p className="px-5 py-6 text-sm text-muted">No guarantors yet.</p>}
          {guarList.map((g) => (
            <div key={g.id} className="flex items-center justify-between gap-4 px-5 py-3">
              <div className="min-w-0">
                <p className="font-medium text-fg">{guarName(g)}</p>
                <p className="truncate text-xs text-muted">{[g.email, g.phone].filter(Boolean).join(" · ") || "—"}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button onClick={() => setEditGuar(g)} className="btn btn-ghost btn-sm">Edit</button>
                <button onClick={() => onDeleteGuar(g.id)} className="btn btn-ghost btn-sm text-[color:var(--status-outstanding)]">Delete</button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card divide-y divide-line">
          {entityList.length === 0 && <p className="px-5 py-6 text-sm text-muted">No entities yet.</p>}
          {entityList.map((e) => (
            <div key={e.id} className="flex items-center justify-between gap-4 px-5 py-3">
              <div className="min-w-0">
                <p className="font-medium text-fg">{e.name}</p>
                <p className="truncate text-xs text-muted">
                  {[e.ein && `EIN ${e.ein}`, e.members.length ? `${e.members.length} member(s)` : ""].filter(Boolean).join(" · ") || "—"}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button onClick={() => setEditEntity(e)} className="btn btn-ghost btn-sm">Edit</button>
                <button onClick={() => onDeleteEntity(e.id)} className="btn btn-ghost btn-sm text-[color:var(--status-outstanding)]">Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editGuar && <GuarantorForm initial={editGuar} onSave={onSaveGuar} onCancel={() => setEditGuar(null)} />}
      {editEntity && (
        <EntityForm initial={editEntity} guarantors={guarantors} onSave={onSaveEntity} onCancel={() => setEditEntity(null)} />
      )}
    </div>
  );
}

function Field({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-xs font-medium text-muted">{label}</span>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} className="field" />
    </label>
  );
}

function Modal({ title, onCancel, children, onSave, busy }: { title: string; onCancel: () => void; children: React.ReactNode; onSave: () => void; busy: boolean }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4 backdrop-blur-sm" onMouseDown={onCancel}>
      <div className="card w-full max-w-lg p-6" onMouseDown={(e) => e.stopPropagation()}>
        <h2 className="mb-4 text-lg font-bold text-fg">{title}</h2>
        <div className="flex max-h-[70vh] flex-col gap-3 overflow-y-auto">{children}</div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onCancel} className="btn btn-ghost btn-sm">Cancel</button>
          <button onClick={onSave} disabled={busy} className="btn btn-primary btn-sm">{busy ? "Saving…" : "Save"}</button>
        </div>
      </div>
    </div>
  );
}

function GuarantorForm({ initial, onSave, onCancel }: { initial: Guarantor; onSave: (g: Guarantor) => Promise<void>; onCancel: () => void }) {
  const [g, setG] = useState(initial);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof Guarantor) => (v: string) => setG((p) => ({ ...p, [k]: v }));
  return (
    <Modal title={g.id ? "Edit guarantor" : "New guarantor"} onCancel={onCancel} busy={busy} onSave={async () => { setBusy(true); await onSave(g); setBusy(false); }}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="First name" value={g.firstName} onChange={set("firstName")} />
        <Field label="Last name" value={g.lastName} onChange={set("lastName")} />
        <Field label="Email" value={g.email} onChange={set("email")} />
        <Field label="Phone" value={g.phone} onChange={set("phone")} />
        <Field label="SSN" value={g.ssn} onChange={set("ssn")} />
        <Field label="Date of birth" value={g.dateOfBirth} onChange={set("dateOfBirth")} type="date" />
      </div>
      <Field label="Mailing address" value={g.mailingAddress} onChange={set("mailingAddress")} />
    </Modal>
  );
}

function EntityForm({ initial, guarantors, onSave, onCancel }: { initial: Entity; guarantors: Guarantor[]; onSave: (e: Entity) => Promise<void>; onCancel: () => void }) {
  const [e, setE] = useState(initial);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof Entity) => (v: string) => setE((p) => ({ ...p, [k]: v }));
  const setMember = (i: number, patch: Partial<EntityMember>) =>
    setE((p) => ({ ...p, members: p.members.map((m, j) => (j === i ? { ...m, ...patch } : m)) }));
  const addMember = () => setE((p) => ({ ...p, members: [...p.members, { name: "", ownershipPct: "", guarantorId: null }] }));
  const removeMember = (i: number) => setE((p) => ({ ...p, members: p.members.filter((_, j) => j !== i) }));
  return (
    <Modal title={e.id ? "Edit entity" : "New entity"} onCancel={onCancel} busy={busy} onSave={async () => { setBusy(true); await onSave(e); setBusy(false); }}>
      <Field label="Entity name" value={e.name} onChange={set("name")} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="EIN" value={e.ein} onChange={set("ein")} />
        <Field label="Entity type" value={e.entityType} onChange={set("entityType")} />
        <Field label="State of formation" value={e.stateOfFormation} onChange={set("stateOfFormation")} />
      </div>
      <Field label="Mailing address" value={e.mailingAddress} onChange={set("mailingAddress")} />
      <div>
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Members</p>
        <div className="flex flex-col gap-2">
          {e.members.map((m, i) => (
            <div key={i} className="flex items-center gap-2">
              <input value={m.name} onChange={(ev) => setMember(i, { name: ev.target.value })} placeholder="Name" className="field field-sm flex-1" />
              <input value={m.ownershipPct} onChange={(ev) => setMember(i, { ownershipPct: ev.target.value })} placeholder="%" className="field field-sm w-16" />
              <select
                value={m.guarantorId ?? ""}
                onChange={(ev) => setMember(i, { guarantorId: ev.target.value || null })}
                className="field field-sm w-40"
                title="Link to a guarantor (optional)"
              >
                <option value="">— link guarantor —</option>
                {guarantors.map((g) => (
                  <option key={g.id} value={g.id}>{guarName(g)}</option>
                ))}
              </select>
              <button onClick={() => removeMember(i)} aria-label="Remove member" className="btn btn-ghost px-2 text-[color:var(--status-outstanding)]">×</button>
            </div>
          ))}
        </div>
        <button onClick={addMember} className="btn btn-secondary btn-sm mt-2">+ Add member</button>
      </div>
    </Modal>
  );
}
