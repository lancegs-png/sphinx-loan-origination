"use client";

import { useState } from "react";

/**
 * Broker portal: shows the broker's personal shareable intake link with a copy button.
 * Submissions through the link tie the resulting deal to this broker (see getMyBrokerIntakeLink
 * / submitPublicIntake). The link points at the public /apply/<token> white-label form.
 */
export function BrokerShareLink({ url, error }: { url: string | null; error: string | null }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — the field is selectable to copy by hand */
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl">
      <h1 className="text-xl font-bold text-fg">Share your intake link</h1>
      <p className="mt-1 text-sm text-muted">
        Send this link to anyone in your network. When they complete the form, the deal is added to
        your pipeline automatically and tied to you.
      </p>

      {error ? (
        <p className="mt-6 text-sm text-red-600">Could not load your link: {error}</p>
      ) : (
        <div className="card mt-6 flex flex-col gap-3 p-5">
          <label htmlFor="broker-link" className="text-xs font-medium text-muted">
            Your intake link
          </label>
          <div className="flex items-center gap-2">
            <input
              id="broker-link"
              readOnly
              value={url ?? ""}
              onFocus={(e) => e.currentTarget.select()}
              className="field w-full font-mono text-sm"
            />
            <button onClick={copy} className="btn btn-primary shrink-0">
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
          <p className="text-xs text-faint">
            This is a neutral, white-label form — it doesn&apos;t show Sphinx branding. Anyone with
            the link can submit a scenario; each submission lands in your pipeline.
          </p>
        </div>
      )}
    </div>
  );
}
