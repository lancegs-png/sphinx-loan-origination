"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { setUserType, addUser, type UserType } from "@/app/actions";

export type UserRow = {
  id: string;
  email: string;
  full_name: string | null;
  is_lending_team: boolean;
  lender_user_type: "admin" | "operations" | "account_manager" | null;
  external_type: string | null;
};

const TYPES: { value: UserType; label: string }[] = [
  { value: "borrower", label: "Borrower" },
  { value: "originator", label: "Originator" },
  { value: "account_manager", label: "Account Manager" },
  { value: "operations", label: "Operations" },
  { value: "admin", label: "Admin" },
];

const LABEL: Record<UserType, string> = {
  borrower: "Borrower",
  originator: "Originator",
  account_manager: "Account Manager",
  operations: "Operations",
  admin: "Admin",
};

function typeOf(u: UserRow): UserType {
  if (u.is_lending_team && u.lender_user_type) return u.lender_user_type;
  return (u.external_type as UserType) ?? "borrower";
}

export function UsersRolesEditor({
  initial,
  currentUserId,
}: {
  initial: UserRow[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<"all" | UserType>("all");
  const [msg, setMsg] = useState<string | null>(null);

  // Add-user form
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [newType, setNewType] = useState<UserType>("borrower");
  const [busy, setBusy] = useState(false);
  const [tempPassword, setTempPassword] = useState<string | null>(null);

  const shown = useMemo(
    () => (filter === "all" ? initial : initial.filter((u) => typeOf(u) === filter)),
    [initial, filter],
  );

  async function add() {
    if (!email.trim()) return;
    setBusy(true);
    setMsg(null);
    setTempPassword(null);
    const res = await addUser({ email, fullName: name, userType: newType });
    setBusy(false);
    if (res.ok) {
      setTempPassword(res.tempPassword ?? null);
      setMsg(`Created ${email.trim().toLowerCase()} as ${LABEL[newType]}.`);
      setEmail("");
      setName("");
      router.refresh();
    } else {
      setMsg(res.error ?? "Could not create user.");
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Users &amp; Roles</h1>
          <p className="text-muted">Everyone with access, and their type.</p>
        </div>
        <Link href="/admin" className="rounded-md border border-line px-4 py-2.5 font-medium">
          ← Admin
        </Link>
      </header>

      {/* Add user */}
      <section className="mb-8 rounded-md border border-line p-5">
        <h2 className="mb-4 text-lg font-semibold">Add a user</h2>
        <div className="flex flex-col gap-3">
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            type="email"
            className="rounded-md border border-line px-3 py-2.5 text-base"
          />
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Full name (optional)"
            className="rounded-md border border-line px-3 py-2.5 text-base"
          />
          <label className="flex items-center gap-2 text-sm">
            Type
            <select
              value={newType}
              onChange={(e) => setNewType(e.target.value as UserType)}
              className="rounded-md border border-line px-2 py-1.5"
            >
              {TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <button
            onClick={add}
            disabled={busy}
            className="self-start rounded-md bg-fg px-5 py-2.5 font-medium text-white disabled:opacity-50"
          >
            {busy ? "Creating…" : "Add user"}
          </button>
          {tempPassword && (
            <p className="text-sm">
              Temporary password (share once): <span className="font-mono font-medium">{tempPassword}</span>
            </p>
          )}
        </div>
      </section>

      {/* Filter */}
      <div className="mb-4 flex items-center gap-2 text-sm">
        <span className="text-muted">Filter</span>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as "all" | UserType)}
          className="rounded-md border border-line px-2 py-1.5"
        >
          <option value="all">All</option>
          {TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        <span className="text-muted">
          {shown.length} of {initial.length}
        </span>
      </div>

      <ul className="flex flex-col gap-3">
        {shown.map((u) => (
          <UserRowEditor
            key={u.id}
            user={u}
            isSelf={u.id === currentUserId}
            onSaved={(m) => {
              setMsg(m);
              router.refresh();
            }}
          />
        ))}
      </ul>

      {msg && <p className="mt-4 text-sm">{msg}</p>}
    </main>
  );
}

function UserRowEditor({
  user,
  isSelf,
  onSaved,
}: {
  user: UserRow;
  isSelf: boolean;
  onSaved: (msg: string) => void;
}) {
  const [type, setType] = useState<UserType>(typeOf(user));
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const res = await setUserType({ userId: user.id, userType: type });
    setBusy(false);
    onSaved(res.ok ? "Saved." : res.error ?? "Save failed.");
  }

  return (
    <li className="flex flex-col gap-2 rounded-md border border-line p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-medium">{user.full_name ?? user.email}</div>
          <div className="text-sm text-muted">{user.email}</div>
        </div>
        {isSelf && <span className="text-xs text-muted">you</span>}
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-1.5">
          Type
          <select
            value={type}
            onChange={(e) => setType(e.target.value as UserType)}
            className="rounded-md border border-line px-2 py-1"
          >
            {TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={save}
          disabled={busy}
          className="rounded-md border border-line px-4 py-1.5 font-medium disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </li>
  );
}
