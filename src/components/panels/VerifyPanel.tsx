import clsx from 'clsx'
import type { CorrectionTarget } from '@/components/map/FieldMap'
import { Button } from '@/components/ui/Button'
import { ProvenanceBadge } from '@/components/ui/ProvenanceBadge'
import { distance } from '@/lib/geo/math'
import { useFieldStore } from '@/store/useFieldStore'

interface VerifyPanelProps {
  correctionTarget: CorrectionTarget | null
  onStartWalkStrip: (edgeId: string) => void
  onStartTrimEdge: (edgeId: string) => void
  onCancelCorrection: () => void
}

export function VerifyPanel({ correctionTarget, onStartWalkStrip, onStartTrimEdge, onCancelCorrection }: VerifyPanelProps) {
  const boundary = useFieldStore((s) => s.boundary)
  const projection = useFieldStore((s) => s.projection)
  const readiness = useFieldStore((s) => s.readiness)
  const selectedEdgeId = useFieldStore((s) => s.selectedEdgeId)
  const setSelectedEdgeId = useFieldStore((s) => s.setSelectedEdgeId)
  const setStep = useFieldStore((s) => s.setStep)
  const acceptRisk = useFieldStore((s) => s.acceptRisk)
  const revokeRisk = useFieldStore((s) => s.revokeRisk)
  const lastRecomputeMs = useFieldStore((s) => s.lastRecomputeMs)

  if (!boundary || !readiness) {
    return (
      <div className="p-4 text-sm text-(--text-secondary)">
        No field loaded yet — go back to Import.
      </div>
    )
  }

  const selectedEdge = boundary.edges.find((e) => e.id === selectedEdgeId) ?? null
  // Display-only — matches the "Edge N" numbering the list above already uses, rather than leaking the raw internal edge id (e.g. "e0") into the UI.
  const selectedEdgeNumber = selectedEdge ? boundary.edges.indexOf(selectedEdge) + 1 : null
  const correctionActiveHere = correctionTarget !== null

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <div>
        <h2 className="text-sm font-semibold text-(--text-primary)">Verify boundary</h2>
        <p className="mt-1 text-xs text-(--text-secondary)">
          A satellite trace is a dated prior, not ground truth. Every edge below needs to be walked or confirmed —
          or its risk explicitly accepted — before the flight clears.
        </p>
      </div>

      <div
        className={clsx(
          'rounded-(--radius-card) border p-3',
          readiness.cleared ? 'border-success/30 bg-success-bg' : 'border-warning/30 bg-warning-bg',
        )}
      >
        <div className={clsx('text-sm font-semibold', readiness.cleared ? 'text-success' : 'text-warning')}>
          {readiness.cleared ? 'Cleared for flight' : 'Not cleared for flight'}
        </div>
        {!readiness.cleared && (
          <div className="mt-1 text-xs text-warning">
            {readiness.unverifiedEdges} of {readiness.totalEdges} edges unverified ·{' '}
            {Math.round(readiness.unverifiedLengthM)}m of boundary unchecked
            {readiness.acceptedRiskEdges > 0 && ` · ${readiness.acceptedRiskEdges} accepted`}
          </div>
        )}
        {lastRecomputeMs !== null && (
          <div className="mt-1 text-[11px] text-(--text-muted)">Re-planned in {lastRecomputeMs.toFixed(1)}ms</div>
        )}
      </div>

      <section className="space-y-1.5">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-(--text-muted)">
          Edges ({boundary.edges.length})
        </h3>
        <ul className="space-y-1.5">
          {boundary.edges.map((edge, i) => {
            const a = boundary.vertices[edge.fromIndex]
            const b = boundary.vertices[edge.toIndex]
            const lengthM = projection ? distance(projection.toLocal(a), projection.toLocal(b)) : null
            const isSelected = edge.id === selectedEdgeId
            const isBlocking = readiness.blockingEdgeIds.includes(edge.id)

            return (
              <li key={edge.id}>
                <button
                  type="button"
                  disabled={correctionActiveHere}
                  onClick={() => setSelectedEdgeId(isSelected ? null : edge.id)}
                  className={clsx(
                    'flex w-full items-center justify-between rounded-(--radius-control) border px-2.5 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                    isSelected
                      ? 'border-brand-400 bg-brand-50'
                      : 'border-(--border-subtle) bg-(--surface-panel) hover:bg-(--surface-panel-raised)',
                  )}
                >
                  <span className="flex items-center gap-2">
                    <span className="text-(--text-muted)">Edge {i + 1}</span>
                    {lengthM !== null && <span className="tabular-nums text-(--text-secondary)">{Math.round(lengthM)}m</span>}
                    {isBlocking && <span className="h-1.5 w-1.5 rounded-full bg-warning" title="Blocking clearance" />}
                  </span>
                  <ProvenanceBadge kind={edge.provenance.kind} acceptedRisk={edge.provenance.acceptedRisk} />
                </button>
              </li>
            )
          })}
        </ul>
      </section>

      {correctionActiveHere && (
        <section className="space-y-2 rounded-(--radius-card) border border-provenance-walked/30 bg-provenance-walked-bg p-3">
          <p className="text-xs font-medium text-provenance-walked">
            Drag the pilot marker on the map to {correctionTarget?.mode === 'walk-strip' ? 'walk the new strip' : 'walk the true edge'}, then Finish.
          </p>
          <Button size="sm" variant="secondary" onClick={onCancelCorrection}>
            Cancel correction
          </Button>
        </section>
      )}

      {selectedEdge && !correctionActiveHere && (
        <section className="space-y-2 rounded-(--radius-card) border border-brand-200 bg-brand-50 p-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-brand-700">Selected edge</h3>
          <div className="text-sm text-(--text-primary)">
            Edge {selectedEdgeNumber} — <ProvenanceBadge kind={selectedEdge.provenance.kind} acceptedRisk={selectedEdge.provenance.acceptedRisk} className="ml-1" />
          </div>
          {selectedEdge.provenance.kind === 'satellite' && selectedEdge.provenance.imageryDate && (
            <div className="text-xs text-(--text-secondary)">Imagery date: {selectedEdge.provenance.imageryDate}</div>
          )}
          {selectedEdge.provenance.kind === 'walked' && selectedEdge.provenance.accuracyM !== undefined && (
            <div className="text-xs text-(--text-secondary)">GPS accuracy: ±{selectedEdge.provenance.accuracyM.toFixed(1)}m</div>
          )}
          {selectedEdge.provenance.verifiedAt && (
            <div className="text-xs text-(--text-secondary)">
              Verified: {new Date(selectedEdge.provenance.verifiedAt).toLocaleString()}
            </div>
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            <Button size="sm" variant="secondary" onClick={() => onStartWalkStrip(selectedEdge.id)}>
              Walk a strip
            </Button>
            <Button size="sm" variant="secondary" onClick={() => onStartTrimEdge(selectedEdge.id)}>
              Trim an edge
            </Button>
            {selectedEdge.provenance.kind === 'satellite' && !selectedEdge.provenance.acceptedRisk && (
              <Button size="sm" variant="ghost" onClick={() => acceptRisk(selectedEdge.id)}>
                Accept risk
              </Button>
            )}
            {selectedEdge.provenance.kind === 'satellite' && selectedEdge.provenance.acceptedRisk && (
              <Button size="sm" variant="ghost" onClick={() => revokeRisk(selectedEdge.id)}>
                Revoke accepted risk
              </Button>
            )}
          </div>
        </section>
      )}

      <div className="mt-auto pt-2">
        <Button variant="primary" className="w-full" onClick={() => setStep('plan')}>
          {readiness.cleared ? 'Continue to Plan' : 'Continue to Plan anyway'}
        </Button>
      </div>
    </div>
  )
}
