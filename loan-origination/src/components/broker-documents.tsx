"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { LoanDocument } from "@/lib/types";

const DOC_BUCKET = "loan-documents";

/**
 * Broker portal Documents tab: a simple uploader + list, not the checklist-driven staff panel.
 * Uploads are recorded as 'shared' (visible to the Sphinx team) and the list is already scoped
 * by RLS to shared documents plus the broker's own. Downloads go through the signed-URL route.
 */
export function BrokerDocuments({ loanId, documents }: { loanId: string; documents: LoanDocument[] }) {
  const [docs, setDocs] = useState<LoanDocument[]>(documents);
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function upload(fileList: FileList | null) {
    const files = Array.from(fileList ?? []);
    if (!files.length) return;
    setUploading(true);
    setMsg(null);
    try {
      const supabase = createClient();
      // Upload each file straight to Storage via a signed URL, then record the paths.
      const uploads: { storagePath: string; fileName: string; size: number; contentType: string }[] = [];
      for (const f of files) {
        const signRes = await fetch(`/api/loans/${loanId}/documents/sign`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileName: f.name }),
        });
        if (!signRes.ok) {
          setMsg("Upload failed — could not start the upload.");
          return;
        }
        const { path, token } = (await signRes.json()) as { path: string; token: string };
        const { error: upErr } = await supabase.storage
          .from(DOC_BUCKET)
          .uploadToSignedUrl(path, token, f, { contentType: f.type || undefined });
        if (upErr) {
          setMsg(`Upload failed: ${upErr.message}`);
          return;
        }
        uploads.push({ storagePath: path, fileName: f.name, size: f.size, contentType: f.type });
      }
      const res = await fetch(`/api/loans/${loanId}/documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ checklistItemId: null, uploads }),
      });
      if (!res.ok) {
        setMsg((await res.text().catch(() => "")) || "Upload failed.");
        return;
      }
      const json = (await res.json()) as { documents: LoanDocument[] };
      setDocs((prev) => [...json.documents, ...prev]);
      setMsg(`Uploaded ${json.documents.length} file${json.documents.length === 1 ? "" : "s"}.`);
    } catch {
      setMsg("Upload failed.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function remove(docId: string) {
    const res = await fetch(`/api/loans/${loanId}/documents/${docId}`, { method: "DELETE" });
    if (!res.ok) {
      setMsg("Could not delete that file — you can only remove documents you uploaded.");
      return;
    }
    setDocs((prev) => prev.filter((d) => d.id !== docId));
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold text-fg">Documents</h2>
        <p className="mt-1 text-sm text-muted">
          Upload documents for this loan — the files you add are shared with the Sphinx team.
        </p>
      </div>

      <div className="card flex flex-col items-start gap-3 p-5">
        <input ref={inputRef} type="file" multiple className="hidden" onChange={(e) => upload(e.target.files)} />
        <button onClick={() => inputRef.current?.click()} disabled={uploading} className="btn btn-primary">
          {uploading ? "Uploading…" : "Upload documents"}
        </button>
        {msg && <p className="text-sm text-muted">{msg}</p>}
      </div>

      {docs.length > 0 ? (
        <div className="card overflow-hidden">
          <ul className="divide-y divide-line">
            {docs.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <a
                  href={`/api/loans/${loanId}/documents/${d.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="truncate text-sm font-medium text-fg hover:underline"
                >
                  {d.file_name}
                </a>
                <button onClick={() => remove(d.id)} className="btn btn-ghost shrink-0 text-xs text-muted">
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-sm text-muted">No documents yet.</p>
      )}
    </div>
  );
}
