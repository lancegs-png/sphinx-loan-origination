"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SphinxLogo, SphinxTile } from "@/components/brand";

export type NavItem = {
  href: string;
  label: string;
  icon: "pipeline" | "settings" | "folder";
  match?: "exact" | "prefix";
};

function Icon({ name }: { name: NavItem["icon"] }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (name) {
    case "pipeline":
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="4" rx="1" />
          <rect x="3" y="10" width="18" height="4" rx="1" />
          <rect x="3" y="16" width="12" height="4" rx="1" />
        </svg>
      );
    case "settings":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
        </svg>
      );
    case "folder":
      return (
        <svg {...common}>
          <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
        </svg>
      );
  }
}

function NavLinks({ nav, pathname }: { nav: NavItem[]; pathname: string }) {
  return (
    <nav className="flex flex-col gap-0.5">
      {nav.map((item) => {
        const active =
          item.match === "prefix" ? pathname.startsWith(item.href) : pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              active ? "bg-navy/[0.06] text-navy" : "text-muted hover:bg-surface-2 hover:text-fg"
            }`}
          >
            <span
              aria-hidden
              className={`absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full transition-colors ${
                active ? "bg-gold" : "bg-transparent"
              }`}
            />
            <span className={active ? "text-navy" : "text-faint group-hover:text-muted"}>
              <Icon name={item.icon} />
            </span>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function AppShell({
  email,
  nav,
  children,
}: {
  email: string;
  nav: NavItem[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const initial = (email?.[0] ?? "?").toUpperCase();

  return (
    <div className="flex min-h-screen">
      {/* Sidebar (desktop) */}
      <aside className="sticky top-0 hidden h-screen w-52 shrink-0 flex-col border-r border-line bg-surface md:flex">
        <div className="px-5 pb-4 pt-6">
          <Link href="/" aria-label="Sphinx Capital — Pipeline" className="block">
            <SphinxLogo fluid />
          </Link>
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-2">
          <NavLinks nav={nav} pathname={pathname} />
        </div>
        <div className="border-t border-line p-3">
          <div className="flex items-center gap-3 rounded-lg px-2 py-2">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-navy text-xs font-semibold text-white">
              {initial}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-fg">{email}</span>
            </span>
          </div>
          <form action="/auth/signout" method="post" className="mt-1">
            <button className="btn btn-ghost w-full justify-start px-2">Sign out</button>
          </form>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-20 flex h-14 w-full items-center justify-between border-b border-line bg-surface/90 px-4 backdrop-blur md:hidden">
        <Link href="/" className="flex items-center gap-2" aria-label="Sphinx Capital">
          <SphinxTile size={30} rounded={8} />
          <span className="font-display text-base font-bold text-navy">Sphinx Capital</span>
        </Link>
        <form action="/auth/signout" method="post">
          <button className="btn btn-ghost px-2 text-sm">Sign out</button>
        </form>
      </header>

      {/* Main */}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
