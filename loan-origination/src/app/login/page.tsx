"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Mode = "magic" | "password";

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>("magic");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const redirectTo =
    typeof window !== "undefined" ? `${window.location.origin}/auth/callback` : undefined;

  async function sendMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: redirectTo },
      });
      setMessage(
        error
          ? `Couldn’t send link: ${error.message}`
          : "Link Emailed! Check your inbox for the sign-in link.",
      );
    } catch (err) {
      setMessage(
        `Couldn’t send link: ${err instanceof Error ? err.message : "unknown error"}`,
      );
    } finally {
      setBusy(false);
    }
  }

  async function passwordAuth(e: React.FormEvent, kind: "in" | "up") {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    const supabase = createClient();
    const fn =
      kind === "in"
        ? supabase.auth.signInWithPassword({ email, password })
        : supabase.auth.signUp({ email, password, options: { emailRedirectTo: redirectTo } });
    const { error } = await fn;
    setBusy(false);
    if (error) setMessage(error.message);
    else if (kind === "up") setMessage("Account created. If email confirmation is on, check your inbox.");
    else window.location.href = "/";
  }

  async function google() {
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-8 px-5">
      <div>
        <h1 className="text-2xl font-semibold">Loan Origination</h1>
        <p className="mt-1 text-muted">Sign in to continue</p>
      </div>

      {mode === "magic" ? (
        <form onSubmit={sendMagicLink} className="flex flex-col gap-4">
          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium">Email</span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded-md border border-line px-3 py-2.5 text-base"
              placeholder="you@example.com"
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-fg px-4 py-2.5 font-medium text-white disabled:opacity-50"
          >
            {busy ? "Sending…" : "Email me a sign-in link"}
          </button>
        </form>
      ) : (
        <form className="flex flex-col gap-4">
          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium">Email</span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded-md border border-line px-3 py-2.5 text-base"
            />
          </label>
          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium">Password</span>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="rounded-md border border-line px-3 py-2.5 text-base"
            />
          </label>
          <div className="flex gap-3">
            <button
              onClick={(e) => passwordAuth(e, "in")}
              disabled={busy}
              className="flex-1 rounded-md bg-fg px-4 py-2.5 font-medium text-white disabled:opacity-50"
            >
              Sign in
            </button>
            <button
              onClick={(e) => passwordAuth(e, "up")}
              disabled={busy}
              className="flex-1 rounded-md border border-line px-4 py-2.5 font-medium"
            >
              Sign up
            </button>
          </div>
        </form>
      )}

      <button onClick={google} className="rounded-md border border-line px-4 py-2.5 font-medium">
        Continue with Google
      </button>

      <button
        onClick={() => {
          setMessage(null);
          setMode(mode === "magic" ? "password" : "magic");
        }}
        className="text-sm text-muted underline"
      >
        {mode === "magic" ? "Use a password instead" : "Use a magic link instead"}
      </button>

      {message && <p className="text-sm">{message}</p>}
    </main>
  );
}
