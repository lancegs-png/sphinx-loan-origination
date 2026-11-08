"use client";

import { useState } from "react";
import { saveLoanField, saveDealContacts } from "@/app/actions";
import type { DealContact, FieldValues, Participant } from "@/lib/types";

function participantRoleLabel(role: string) {
  if (role === "lending_team") return "Lending team";
  if (role === "originator") return "Originator";
  if (role === "borrower") return "Borrower";
  return role;
}

const val = (values: FieldValues, key: string) => {
  const v = values[key]?.current;
  return v == null ? "" : String(v);
};

export function PeoplePanel({
  loanId,
  participants,
  values,
  initialContacts,
  canEdit,
}: {
  loanId: string;
  participants: Participant[];
  values: FieldValues;
  initialContacts: DealContact[];
  canEdit: boolean;
}) {
  return (
    <div className="flex flex-col gap-6">
      {/* Accounts with a login to this deal */}
      <Group title="Participants">
        {participants.length === 0 && <p className="text-muted">No one added yet.</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          {participants.map((p) => (
            <div key={p.user_id} className="card p-3.5">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-fg">
                  {p.profiles?.full_name ?? p.profiles?.email ?? "—"}
                </span>
                <span className="chip">{participantRoleLabel(p.participant_role)}</span>
              </div>
              {p.profiles?.email && <div className="mt-1 text-muted">{p.profiles.email}</div>}
              {p.profiles?.phone && <div className="text-muted">{p.profiles.phone}</div>}
            </div>
          ))}
        </div>
      </Group>

      {/* Contacts — all backed by the loan field store, so they're editable here and on Loan Info */}
      <Group title="Contacts">
        <div className="grid gap-3 sm:grid-cols-2">
          <FixedContact
            loanId={loanId}
            label="Guarantor"
            canEdit={canEdit}
            values={values}
            lines={[
              { label: "First", key: "guarantor_first_name" },
              { label: "Last", key: "guarantor_last_name" },
              { label: "Email", key: "guarantor_email" },
              { label: "Phone", key: "guarantor_phone" },
            ]}
          />
          <FixedContact
            loanId={loanId}
            label="Title / closing agent"
            canEdit={canEdit}
            values={values}
            lines={[
              { label: "Name", key: "title_contact_name" },
              { label: "Email", key: "title_contact_email" },
              { label: "Phone", key: "title_contact_phone" },
            ]}
          />
          <FixedContact
            loanId={loanId}
            label="Insurance"
            canEdit={canEdit}
            values={values}
            lines={[
              { label: "Name", key: "insurance_contact_name" },
              { label: "Email", key: "insurance_contact_email" },
              { label: "Phone", key: "insurance_contact_phone" },
            ]}
          />
        </div>
      </Group>

      <ExtraContacts loanId={loanId} initial={initialContacts} canEdit={canEdit} />
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{title}</h3>
      {children}
    </section>
  );
}

/** A contact backed by fixed field-store keys. Saves each line on blur, so the same
 *  values are editable here and wherever else those fields appear (e.g. Loan Info). */
function FixedContact({
  loanId,
  label,
  canEdit,
  values,
  lines,
}: {
  loanId: string;
  label: string;
  canEdit: boolean;
  values: FieldValues;
  lines: { label: string; key: string }[];
}) {
  const save = (key: string, value: string, baseline: string) => {
    if (value === baseline) return;
    void saveLoanField({ loanId, key, type: "text", value, valueKind: "initial" });
  };
  return (
    <div className="card p-3.5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="chip">{label}</span>
      </div>
      <div className="flex flex-col gap-2">
        {lines.map((ln) => (
          <ContactLine
            key={ln.key}
            label={ln.label}
            k={ln.key}
            base={val(values, ln.key)}
            canEdit={canEdit}
            onSave={save}
          />
        ))}
      </div>
    </div>
  );
}

function ContactLine({
  label,
  k,
  base,
  canEdit,
  onSave,
}: {
  label: string;
  k: string;
  base: string;
  canEdit: boolean;
  onSave: (key: string, value: string, baseline: string) => void;
}) {
  const [value, setValue] = useState(base);
  if (!canEdit) {
    return (
      <div className="text-sm">
        <span className="text-muted">{label}: </span>
        <span className="text-fg">{base || "—"}</span>
      </div>
    );
  }
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="w-12 shrink-0 text-xs text-muted">{label}</span>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => onSave(k, value, base)}
        placeholder="—"
        className="field field-sm w-full"
      />
    </label>
  );
}

/** Free-form extra contacts stored on custom_fields.contacts. Add/remove/edit, saved as a set. */
function ExtraContacts({
  loanId,
  initial,
  canEdit,
}: {
  loanId: string;
  initial: DealContact[];
  canEdit: boolean;
}) {
  const [contacts, setContacts] = useState<DealContact[]>(initial);
  const [status, setStatus] = useState<string | null>(null);

  async function persist(next: DealContact[]) {
    setContacts(next);
    const res = await saveDealContacts({ loanId, contacts: next });
    setStatus(res.ok ? null : res.error ?? "Couldn’t save contacts.");
  }

  function edit(id: string, patch: Partial<DealContact>) {
    setContacts((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }

  if (!canEdit && contacts.length === 0) return null;

  return (
    <Group title="Other contacts">
      <div className="grid gap-3 sm:grid-cols-2">
        {contacts.map((c) => (
          <div key={c.id} className="card p-3.5">
            {canEdit ? (
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <input
                    value={c.label}
                    onChange={(e) => edit(c.id, { label: e.target.value })}
                    onBlur={() => persist(contacts)}
                    placeholder="Role / title"
                    className="field field-sm w-full font-medium"
                  />
                  <button
                    type="button"
                    onClick={() => persist(contacts.filter((x) => x.id !== c.id))}
                    className="shrink-0 text-xs text-muted underline"
                  >
                    Remove
                  </button>
                </div>
                <ContactLine label="Name" k="name" base={c.name} canEdit onSave={(_, v) => { edit(c.id, { name: v }); persist(contacts.map((x) => (x.id === c.id ? { ...x, name: v } : x))); }} />
                <ContactLine label="Email" k="email" base={c.email} canEdit onSave={(_, v) => { edit(c.id, { email: v }); persist(contacts.map((x) => (x.id === c.id ? { ...x, email: v } : x))); }} />
                <ContactLine label="Phone" k="phone" base={c.phone} canEdit onSave={(_, v) => { edit(c.id, { phone: v }); persist(contacts.map((x) => (x.id === c.id ? { ...x, phone: v } : x))); }} />
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-fg">{c.name || "—"}</span>
                  {c.label && <span className="chip">{c.label}</span>}
                </div>
                {c.email && <div className="mt-1 text-muted">{c.email}</div>}
                {c.phone && <div className="text-muted">{c.phone}</div>}
              </>
            )}
          </div>
        ))}
      </div>
      {canEdit && (
        <button
          type="button"
          onClick={() =>
            setContacts((prev) => [
              ...prev,
              { id: crypto.randomUUID(), label: "", name: "", email: "", phone: "" },
            ])
          }
          className="btn btn-secondary btn-sm mt-3"
        >
          + Add contact
        </button>
      )}
      {status && (
        <p className="mt-2 text-xs" style={{ color: "var(--status-outstanding)" }}>
          {status}
        </p>
      )}
    </Group>
  );
}
