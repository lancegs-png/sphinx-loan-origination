import type { Metadata } from "next";
import { getActiveApplicationLink } from "@/lib/application/links";

export async function generateMetadata(): Promise<Metadata> {
  return { title: "Loan Application — Sphinx Capital" };
}

/**
 * Public, no-login borrower Loan Application (post-term-sheet). Phase 1 = skeleton: resolves the
 * per-loan link by token through the service role and shows a neutral placeholder for an invalid or
 * inactive token. Phase 2 replaces the placeholder with the prefilled application form.
 */
export default async function ApplicationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const link = await getActiveApplicationLink(token);

  if (!link) {
    return (
      <div className="grid min-h-screen place-items-center bg-surface-2 px-4">
        <div className="card max-w-md p-8 text-center">
          <h1 className="text-lg font-bold text-fg">This link is no longer available</h1>
          <p className="mt-2 text-sm text-muted">
            The application link you followed is inactive, already completed, or invalid. Please request a
            current link.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="grid min-h-screen place-items-center bg-surface-2 px-4">
      <div className="card max-w-md p-8 text-center">
        <h1 className="text-lg font-bold text-fg">Loan Application</h1>
        <p className="mt-2 text-sm text-muted">
          Your application form is being prepared. This secure link is valid — the full prefilled
          application will appear here.
        </p>
      </div>
    </div>
  );
}
