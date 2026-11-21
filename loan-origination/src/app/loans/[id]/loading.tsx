/**
 * Instant loading state for a loan. Next streams this immediately on navigation (it's prefetched
 * with the route) while the page's data loads, so opening a loan from the pipeline shows the
 * workspace shell at once instead of a blank screen. Swapped out when the page is ready.
 */
export default function LoanLoading() {
  return (
    <div className="flex h-screen flex-col bg-surface">
      <header className="border-b border-line px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="h-4 w-20 rounded bg-surface-2" />
          <div className="h-8 w-20 rounded bg-surface-2" />
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-3">
          <div className="h-6 w-72 max-w-full rounded bg-surface-2" />
          <div className="h-5 w-28 rounded-full bg-surface-2" />
        </div>
        <div className="mt-4 h-9 w-full rounded bg-surface-2" />
      </header>

      <div className="flex min-h-0 flex-1">
        <nav className="hidden w-48 shrink-0 flex-col gap-2 border-r border-line bg-surface-2/30 p-3 sm:flex">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-8 rounded bg-surface-2" />
          ))}
        </nav>
        <div className="min-h-0 flex-1 overflow-hidden p-6">
          <div className="mx-auto grid max-w-7xl gap-6 lg:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="card h-48 bg-surface-2/40" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
