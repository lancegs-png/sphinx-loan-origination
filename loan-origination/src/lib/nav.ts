import type { NavItem } from "@/components/app-shell";
import type { Profile } from "@/lib/types";

/**
 * The app's primary left-nav, defined once. Pipeline for everyone; Settings for
 * admins. Every page passes its result to <AppShell nav=…>, so top-level sections
 * live in a single place.
 */
export function navFor(profile?: Pick<Profile, "lender_user_type"> | null): NavItem[] {
  const nav: NavItem[] = [{ href: "/", label: "Pipeline", icon: "pipeline", match: "exact" }];
  if (profile?.lender_user_type === "admin") {
    nav.push({ href: "/admin", label: "Settings", icon: "settings", match: "prefix" });
  }
  return nav;
}
