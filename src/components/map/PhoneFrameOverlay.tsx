/**
 * A phone-shaped mockup shown alongside the map during a Field-Truth
 * Walk correction, so the demo can show what a real pilot would see in
 * their hand while walking a strip or trimming an edge — the desktop
 * map's drag-the-marker interaction (mouse-driven, for a laptop demo)
 * stands in for a real phone's GPS feed, but nothing on screen otherwise
 * looks like a phone. This renders the exact same session state
 * (walkTrace, pilotPosition, accuracyM) FieldMap already tracks, as a
 * mini schematic (not a second live tile-backed map — that would mean a
 * second MapLibre instance for a cosmetic view) plus touch-sized
 * controls that call the same finish/cancel callbacks the desktop
 * toolbar uses.
 */
import { distance } from '@/lib/geo/math'
import type { LocalPoint } from '@/lib/geo/types'
import { fitLocalPointsToViewport } from '@/lib/map/miniMapProjection'
import { PROVENANCE_COLORS } from '@/lib/map/provenanceColors'

const VIEWPORT_SIZE = 232
const VIEWPORT_PADDING = 28

interface PhoneFrameOverlayProps {
  mode: 'walk-strip' | 'trim-edge'
  edgeA: LocalPoint
  edgeB: LocalPoint
  walkTraceLocal: LocalPoint[]
  pilotPositionLocal: LocalPoint | null
  accuracyM: number
  onFinish: () => void
  onCancel: () => void
}

function polylinePoints(points: { x: number; y: number }[]): string {
  return points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
}

export function PhoneFrameOverlay({ mode, edgeA, edgeB, walkTraceLocal, pilotPositionLocal, accuracyM, onFinish, onCancel }: PhoneFrameOverlayProps) {
  const fitPoints = [edgeA, edgeB, ...walkTraceLocal, ...(pilotPositionLocal ? [pilotPositionLocal] : [])]
  const project = fitLocalPointsToViewport(fitPoints, VIEWPORT_SIZE, VIEWPORT_PADDING)

  const edgeStart = project(edgeA)
  const edgeEnd = project(edgeB)
  const tracePoints = walkTraceLocal.map(project)
  const pilotPoint = pilotPositionLocal ? project(pilotPositionLocal) : null
  // Accuracy ring radius: scale the same way the projector scaled distance — measure two points 1m apart under `project` to recover the current px-per-meter factor.
  const pxPerMeter = distance(project(edgeA) as LocalPoint, project({ x: edgeA.x + 1, y: edgeA.y }) as LocalPoint)
  const accuracyRadiusPx = Math.max(accuracyM * pxPerMeter, 3)

  const walkedDistanceM = walkTraceLocal.reduce((sum, p, i) => (i === 0 ? 0 : sum + distance(walkTraceLocal[i - 1], p)), 0)

  return (
    <div className="pointer-events-none absolute bottom-4 right-4 z-20 flex w-[248px] flex-col items-center">
      <div className="pointer-events-auto rounded-[2.25rem] border-[6px] border-ink-900 bg-ink-900 shadow-(--shadow-panel)" style={{ width: 248 }}>
        {/* Status bar */}
        <div className="flex items-center justify-between rounded-t-[1.75rem] bg-ink-900 px-4 pb-1 pt-2 text-[10px] font-medium text-white">
          <span>9:41</span>
          <div className="flex items-center gap-1">
            <span aria-hidden="true">▂▄▆█</span>
            <span aria-hidden="true">📶</span>
            <span aria-hidden="true">🔋</span>
          </div>
        </div>

        {/* Screen */}
        <div className="bg-white px-3 pb-3 pt-1">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-semibold text-(--text-primary)">FieldWise — Pilot</span>
            <span className="rounded-full bg-provenance-walked-bg px-1.5 py-0.5 text-[9px] font-medium text-provenance-walked">
              GPS ±{accuracyM.toFixed(1)}m
            </span>
          </div>

          <svg width={VIEWPORT_SIZE} height={VIEWPORT_SIZE} viewBox={`0 0 ${VIEWPORT_SIZE} ${VIEWPORT_SIZE}`} className="rounded-lg bg-ink-100">
            {/* Reference edge — where the satellite trace currently thinks the boundary is */}
            <line x1={edgeStart.x} y1={edgeStart.y} x2={edgeEnd.x} y2={edgeEnd.y} stroke={PROVENANCE_COLORS.satellite} strokeWidth={2} strokeDasharray="4 4" />
            {/* Walked trace so far */}
            {tracePoints.length > 1 && <polyline points={polylinePoints(tracePoints)} fill="none" stroke={PROVENANCE_COLORS.walked} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />}
            {/* Current position: accuracy ring + pulsing dot */}
            {pilotPoint && (
              <>
                <circle cx={pilotPoint.x} cy={pilotPoint.y} r={accuracyRadiusPx} fill={PROVENANCE_COLORS.walked} fillOpacity={0.15} stroke={PROVENANCE_COLORS.walked} strokeOpacity={0.4} />
                <circle cx={pilotPoint.x} cy={pilotPoint.y} r={5} fill={PROVENANCE_COLORS.walked} />
              </>
            )}
          </svg>

          <p className="mt-2 text-center text-[11px] font-medium text-(--text-primary)">
            {mode === 'walk-strip' ? 'Walking the new strip' : 'Walking the true edge'}
          </p>
          <p className="text-center text-[10px] text-(--text-muted)">
            {walkTraceLocal.length} point{walkTraceLocal.length === 1 ? '' : 's'} · {walkedDistanceM.toFixed(0)}m walked
          </p>

          <div className="mt-2.5 flex gap-1.5">
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 rounded-full border border-(--border-subtle) bg-(--surface-panel) py-2 text-[11px] font-medium text-(--text-secondary)"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={walkTraceLocal.length === 0}
              onClick={onFinish}
              className="flex-[1.4] rounded-full bg-brand-600 py-2 text-[11px] font-semibold text-white disabled:bg-ink-200 disabled:text-ink-400"
            >
              Finish walk
            </button>
          </div>
        </div>

        {/* Home indicator bar */}
        <div className="flex justify-center rounded-b-[1.75rem] bg-ink-900 py-1.5">
          <div className="h-1 w-20 rounded-full bg-white/40" />
        </div>
      </div>
      <span className="pointer-events-none mt-1.5 rounded-full bg-ink-900/80 px-2 py-0.5 text-[10px] text-white">Pilot's phone (simulated)</span>
    </div>
  )
}
