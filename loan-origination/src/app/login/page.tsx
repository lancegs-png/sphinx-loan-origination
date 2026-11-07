"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { SphinxLogo } from "@/components/brand";

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
          : "Link emailed. Check your inbox for the sign-in link.",
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
    <main className="grid min-h-screen place-items-center px-5 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <SphinxLogo height={66} />
          <h1 className="mt-7 text-2xl font-bold text-fg">Sign in</h1>
          <p className="mt-1 text-sm text-muted">Private loan origination</p>
        </div>

        <div className="card p-6">
          {mode === "magic" ? (
            <form onSubmit={sendMagicLink} className="flex flex-col gap-4">
              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-medium text-fg">Email</span>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="field w-full"
                  placeholder="you@example.com"
                />
              </label>
              <button type="submit" disabled={busy} className="btn btn-primary w-full">
                {busy ? "Sending…" : "Email me a sign-in link"}
              </button>
            </form>
          ) : (
            <form className="flex flex-col gap-4">
              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-medium text-fg">Email</span>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="field w-full"
                  placeholder="you@example.com"
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-medium text-fg">Password</span>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="field w-full"
                />
              </label>
              <div className="flex gap-3">
                <button
                  onClick={(e) => passwordAuth(e, "in")}
                  disabled={busy}
                  className="btn btn-primary flex-1"
                >
                  Sign in
                </button>
                <button
                  onClick={(e) => passwordAuth(e, "up")}
                  disabled={busy}
                  className="btn btn-secondary flex-1"
                >
                  Sign up
                </button>
              </div>
            </form>
          )}

          <div className="my-4 flex items-center gap-3 text-xs text-faint">
            <span className="h-px flex-1 bg-line" />
            or
            <span className="h-px flex-1 bg-line" />
          </div>

          <button onClick={google} className="btn btn-secondary w-full">
            Continue with Google
          </button>
        </div>

        <div className="mt-5 text-center">
          <button
            onClick={() => {
              setMessage(null);
              setMode(mode === "magic" ? "password" : "magic");
            }}
            className="text-sm text-muted underline decoration-line underline-offset-2 hover:text-fg"
          >
            {mode === "magic" ? "Use a password instead" : "Use a magic link instead"}
          </button>
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
