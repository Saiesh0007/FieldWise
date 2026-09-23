interface StatCardProps {
  label: string
  value: string
  unit?: string
  hint?: string
  /** A denser tile for cramped grids (e.g. live telemetry, several stats per row) — smaller padding and value text than the default headline size (Plan's/Simulate's stat grids, which have room to spare). */
  compact?: boolean
}

/** A single labeled stat tile — sorties, litres, minutes, area, etc. Deliberately plain (no charting): these are headline numbers, not a trend to visualize. */
export function StatCard({ label, value, unit, hint, compact = false }: StatCardProps) {
  return (
    <div className={compact ? 'rounded-(--radius-card) border border-(--border-subtle) bg-(--surface-panel) px-2.5 py-2' : 'rounded-(--radius-card) border border-(--border-subtle) bg-(--surface-panel) p-4'}>
      <div className="text-xs font-medium text-(--text-muted)">{label}</div>
      <div className={compact ? 'flex items-baseline gap-1' : 'mt-1 flex items-baseline gap-1'}>
        <span className={compact ? 'text-base font-semibold tabular-nums text-(--text-primary)' : 'text-2xl font-semibold tabular-nums text-(--text-primary)'}>{value}</span>
        {unit && <span className="text-xs text-(--text-secondary)">{unit}</span>}
      </div>
      {hint && <div className="text-[11px] text-(--text-muted)">{hint}</div>}
    </div>
  )
}
