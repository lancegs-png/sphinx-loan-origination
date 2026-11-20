import type { Metadata } from "next";
import { getActiveLink } from "@/lib/intake/links";
import { PublicIntakeForm } from "@/components/public-intake-form";

/** Per-branding browser-tab title, so a white-label link never shows "Sphinx Capital". */
export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  const link = await getActiveLink(token);
  return { title: link?.branding === "sphinx" ? "Sphinx Capital" : "Loan Application" };
}

/**
 * Public, no-login intake form (Phase 3). Resolves the shareable link by token (service role)
 * and renders the branded or white-label form. An unknown or deactivated token shows a neutral
 * "link unavailable" page rather than leaking anything.
 */
export default async function ApplyPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const link = await getActiveLink(token);

  if (!link) {
    return (
      <div className="grid min-h-screen place-items-center bg-surface-2 px-4">
        <div className="card max-w-md p-8 text-center">
          <h1 className="text-lg font-bold text-fg">This link is no longer available</h1>
          <p className="mt-2 text-sm text-muted">
            The intake link you followed is inactive or invalid. Please request a current link.
          </p>
        </div>
      </div>
    );
  }

  return <PublicIntakeForm token={link.token} branding={link.branding} />;
}
