interface RecomputeTimingBadgeProps {
  lastRecomputeMs: number | null
}

/**
 * "The plan re-plans in ~1s after a correction" is a specific claim made
 * to judges, so it needs a number they can watch update live — not
 * something taken on faith. Always visible in the header, regardless of
 * which step is active, since a correction on Verify should visibly
 * change this before the pilot even leaves that screen.
 */
export function RecomputeTimingBadge({ lastRecomputeMs }: RecomputeTimingBadgeProps) {
  if (lastRecomputeMs === null) return null

  return (
    <div className="flex items-center gap-1.5 whitespace-nowrap rounded-full border border-(--border-subtle) bg-(--surface-panel) px-2.5 py-1 text-xs text-(--text-muted)" title="Time to recompute the spray plan + readiness after the last change">
      <svg viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3 shrink-0 text-brand-500" aria-hidden="true">
        <path d="M8.6 1 3 9h3.6l-.9 6L13 7H9.4l.9-6Z" />
      </svg>
      Re-planned in {lastRecomputeMs.toFixed(1)}ms
    </div>
  )
}
