import clsx from 'clsx'
import type { ReadinessSummary } from '@/lib/geo/types'

interface ReadinessBadgeProps {
  readiness: ReadinessSummary | null
}

/**
 * The Flight Readiness Gate, always visible — this is the visible
 * enforcement of "never trust the satellite input blindly". It reads a
 * precomputed summary rather than boundary data directly; the actual
 * gating logic lives in lib/geo/readiness.ts.
 */
export function ReadinessBadge({ readiness }: ReadinessBadgeProps) {
  if (!readiness) {
    return (
      <div className="flex items-center gap-1.5 whitespace-nowrap rounded-full border border-(--border-subtle) bg-(--surface-panel) px-3 py-1.5 text-sm text-(--text-muted)">
        <span className="h-2 w-2 shrink-0 rounded-full bg-ink-300" />
        No field loaded
      </div>
    )
  }

  if (readiness.cleared) {
    return (
      <div className="flex items-center gap-1.5 whitespace-nowrap rounded-full border border-success/20 bg-success-bg px-3 py-1.5 text-sm font-medium text-success">
        <svg viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5 shrink-0" aria-hidden="true">
          <circle cx="8" cy="8" r="7" fill="currentColor" fillOpacity="0.15" />
          <path d="M5 8.3 7.1 10.4 11.2 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Cleared for flight
      </div>
    )
  }

  return (
    <div
      className={clsx(
        'flex items-center gap-1.5 whitespace-nowrap rounded-full border border-warning/20 bg-warning-bg px-3 py-1.5 text-sm font-medium text-warning',
      )}
    >
      <svg viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5 shrink-0" aria-hidden="true">
        <circle cx="8" cy="8" r="7" fill="currentColor" fillOpacity="0.15" />
        <path d="M8 5v3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <circle cx="8" cy="11" r="0.9" fill="currentColor" />
      </svg>
      {readiness.unverifiedEdges} unverified edge{readiness.unverifiedEdges === 1 ? '' : 's'} ·{' '}
      {Math.round(readiness.unverifiedLengthM)} m
    </div>
  )
}
