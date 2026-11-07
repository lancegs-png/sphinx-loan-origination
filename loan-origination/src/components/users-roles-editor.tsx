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
    <main className="mx-auto max-w-5xl px-6 py-9 lg:px-10">
      <Link href="/admin" className="text-sm text-muted transition-colors hover:text-fg">
        ← Settings
      </Link>
      <header className="mb-8 mt-3">
        <h1 className="text-[1.75rem] font-bold text-fg">Users &amp; Roles</h1>
        <p className="mt-1 text-sm text-muted">Everyone with access, and their type.</p>
      </header>

      {/* Add user */}
      <section className="card mb-8 p-5">
        <h2 className="mb-4 text-lg font-semibold text-fg">Add a user</h2>
        <div className="flex flex-col gap-3">
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            type="email"
            className="field w-full"
          />
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Full name (optional)"
            className="field w-full"
          />
          <label className="flex items-center gap-2 text-sm">
            Type
            <select
              value={newType}
              onChange={(e) => setNewType(e.target.value as UserType)}
              className="field select w-auto"
            >
              {TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <button onClick={add} disabled={busy} className="btn btn-primary self-start">
            {busy ? "Creating…" : "Add user"}
          </button>
          {tempPassword && (
            <p className="text-sm text-fg">
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
          className="field select w-auto"
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

      {msg && <p className="mt-4 text-sm text-muted">{msg}</p>}
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
    <li className="card flex flex-col gap-2 p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-medium text-fg">{user.full_name ?? user.email}</div>
          <div className="text-sm text-muted">{user.email}</div>
        </div>
        {isSelf && <span className="chip">you</span>}
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-1.5">
          Type
          <select
            value={type}
            onChange={(e) => setType(e.target.value as UserType)}
            className="field select w-auto"
          >
            {TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <button onClick={save} disabled={busy} className="btn btn-secondary text-sm">
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </li>
  );
}
