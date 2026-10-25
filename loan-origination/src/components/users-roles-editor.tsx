"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { setUserRole } from "@/app/actions";

export type UserRow = {
  id: string;
  email: string;
  full_name: string | null;
  is_lending_team: boolean;
  lender_user_type: "admin" | "operations" | "account_manager" | null;
};

export function UsersRolesEditor({
  initial,
  currentUserId,
}: {
  initial: UserRow[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Users &amp; Roles</h1>
          <p className="text-muted">Set who is on the lending team and their role.</p>
        </div>
        <Link href="/admin" className="rounded-md border border-line px-4 py-2.5 font-medium">
          ← Admin
        </Link>
      </header>

      <ul className="flex flex-col gap-3">
        {initial.map((u) => (
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
  const [isLender, setIsLender] = useState(user.is_lending_team);
  const [role, setRole] = useState<UserRow["lender_user_type"]>(user.lender_user_type ?? "operations");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const res = await setUserRole({
      userId: user.id,
      isLendingTeam: isLender,
      lenderUserType: isLender ? role : null,
    });
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
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={isLender}
            onChange={(e) => setIsLender(e.target.checked)}
          />
          Lending team
        </label>
        {isLender && (
          <label className="flex items-center gap-1.5">
            Role
            <select
              value={role ?? "operations"}
              onChange={(e) => setRole(e.target.value as UserRow["lender_user_type"])}
              className="rounded-md border border-line px-2 py-1"
            >
              <option value="admin">Admin</option>
              <option value="operations">Operations</option>
              <option value="account_manager">Account Manager</option>
            </select>
          </label>
        )}
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
