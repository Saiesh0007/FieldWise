import clsx from 'clsx'
import type { ProvenanceKind } from '@/lib/geo/types'

const LABELS: Record<ProvenanceKind, string> = {
  satellite: 'Satellite',
  walked: 'Walked',
  confirmed: 'Confirmed',
}

const CLASSES: Record<ProvenanceKind, string> = {
  satellite: 'bg-provenance-satellite-bg text-provenance-satellite border-provenance-satellite/30',
  walked: 'bg-provenance-walked-bg text-provenance-walked border-provenance-walked/30',
  confirmed: 'bg-provenance-confirmed-bg text-provenance-confirmed border-provenance-confirmed/30',
}

const DOT_CLASSES: Record<ProvenanceKind, string> = {
  satellite: 'bg-provenance-satellite',
  walked: 'bg-provenance-walked',
  confirmed: 'bg-provenance-confirmed',
}

interface ProvenanceBadgeProps {
  kind: ProvenanceKind
  /** True when a satellite (unverified) edge's risk was explicitly accepted rather than walked — a distinct trust state, never rendered as "walked". */
  acceptedRisk?: boolean
  className?: string
}

/** The trust model's smallest visible unit — used in the edge list, and anywhere else a single edge's state needs to read at a glance. */
export function ProvenanceBadge({ kind, acceptedRisk, className }: ProvenanceBadgeProps) {
  if (kind === 'satellite' && acceptedRisk) {
    return (
      <span
        className={clsx(
          'inline-flex items-center gap-1.5 rounded-full border border-provenance-accepted/30 bg-provenance-accepted-bg px-2 py-0.5 text-xs font-medium text-provenance-accepted',
          className,
        )}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-provenance-accepted" />
        Accepted risk
      </span>
    )
  }

  return (
    <span className={clsx('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium', CLASSES[kind], className)}>
      <span className={clsx('h-1.5 w-1.5 rounded-full', DOT_CLASSES[kind])} />
      {LABELS[kind]}
    </span>
  )
}
