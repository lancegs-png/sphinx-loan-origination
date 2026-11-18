"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { SphinxLogo } from "@/components/brand";

type Ready = "checking" | "ok" | "no-session";

/**
 * Set a new password after following a reset link. The /auth/callback route turns the emailed
 * recovery link into a session (exchangeCodeForSession / verifyOtp) and redirects here, so an
 * authenticated user lands on this page; we then call updateUser({ password }). If there's no
 * session (link expired, already used, or opened in a different browser than it was requested),
 * we say so and point back to the login page to request a fresh link.
 */
export default function UpdatePasswordPage() {
  const [ready, setReady] = useState<Ready>("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const supabase = createClient();
        const { data } = await supabase.auth.getUser();
        if (active) setReady(data.user ? "ok" : "no-session");
      } catch {
        if (active) setReady("no-session");
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      setMessage("Use at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setMessage("Those two passwords don’t match.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        setMessage(error.message);
        return;
      }
      setDone(true);
      setMessage("Password updated. Taking you to the app…");
      window.location.href = "/";
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not update the password.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center px-5 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <SphinxLogo height={66} />
          <h1 className="mt-7 text-2xl font-bold text-fg">Set a new password</h1>
          <p className="mt-1 text-sm text-muted">Private loan origination</p>
        </div>

        <div className="card p-6">
          {ready === "checking" && <p className="text-sm text-muted">Checking your reset link…</p>}

          {ready === "no-session" && (
            <div className="flex flex-col gap-3 text-sm text-fg">
              <p>
                This reset link is no longer valid — it may have expired or already been used, or it
                was opened in a different browser than the one that requested it.
              </p>
              <Link href="/login" className="btn btn-primary w-full">
                Back to sign in
              </Link>
            </div>
          )}

          {ready === "ok" && (
            <form onSubmit={submit} className="flex flex-col gap-4">
              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-medium text-fg">New password</span>
                <input
                  type="password"
                  required
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="field w-full"
                  placeholder="At least 8 characters"
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-medium text-fg">Confirm new password</span>
                <input
                  type="password"
                  required
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="field w-full"
                />
              </label>
              <button type="submit" disabled={busy || done} className="btn btn-primary w-full">
                {busy ? "Saving…" : "Update password"}
              </button>
            </form>
          )}
        </div>

        {message && (
          <p className="mt-4 rounded-lg border border-line bg-surface px-4 py-3 text-center text-sm text-fg">
            {message}
          </p>
        )}
      </div>
    </main>
  );
}
