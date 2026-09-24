import { Button } from '@/components/ui/Button'
import type { LatLng } from '@/lib/geo/types'

interface DronePointCaptureProps {
  /** Current list of captured points — driven externally via onPointsChange, so the map can render them live. */
  points: LatLng[]
  onPointsChange: (points: LatLng[]) => void
  onComplete: (vertices: LatLng[]) => void
  onCancel: () => void
  /** Whether a simulated demo auto-play is currently running. */
  isSimulating: boolean
  onStartSimulate: () => void
  onStopSimulate: () => void
}

/**
 * Drone-based boundary plot capture, matching AeroGCS GREEN's "Drone" method.
 *
 * The drone flies to each corner of the field; the pilot taps "+ Add point"
 * to mark the boundary at the drone's current position. In this web demo
 * the "drone position" is wherever the user clicks on the map (shown with a
 * crosshair cursor + top banner), and there is also a simulated auto-play
 * demo that walks the sample field vertices automatically.
 */
export function DronePointCapture({
  points,
  onPointsChange,
  onComplete,
  onCancel,
  isSimulating,
  onStartSimulate,
  onStopSimulate,
}: DronePointCaptureProps) {
  const handleClearAll = () => {
    onStopSimulate()
    onPointsChange([])
  }

  const handleFinish = () => {
    onStopSimulate()
    if (points.length >= 3) onComplete(points)
  }

  const canFinish = points.length >= 3

  return (
    <div className="space-y-3 rounded-(--radius-card) border border-(--border-subtle) bg-(--surface-panel) p-3">
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs text-(--text-secondary)">
          Click the map at each boundary corner to drop a point (simulating the drone's GPS
          position). Or run the auto-play demo.
        </p>
        {points.length > 0 && (
          <button
            type="button"
            className="shrink-0 text-xs text-danger hover:underline"
            onClick={handleClearAll}
          >
            Clear All
          </button>
        )}
      </div>

      {/* Point count badge */}
      {points.length > 0 && (
        <div className="flex items-center gap-1.5 rounded-(--radius-control) border border-provenance-walked/30 bg-provenance-walked-bg px-2.5 py-1.5">
          <svg
            viewBox="0 0 16 16"
            fill="none"
            className="h-3.5 w-3.5 shrink-0 text-provenance-walked"
            aria-hidden="true"
          >
            <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.5" />
            <circle cx="8" cy="8" r="2" fill="currentColor" />
          </svg>
          <span className="text-xs font-medium text-provenance-walked">
            {points.length} point{points.length === 1 ? '' : 's'} captured
            {points.length < 3 && (
              <span className="font-normal text-provenance-walked/70">
                {' '}
                · need {3 - points.length} more
              </span>
            )}
          </span>
          {isSimulating && (
            <span className="ml-auto text-xs italic text-(--text-muted)">auto-flying…</span>
          )}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex flex-wrap gap-2">
        {isSimulating ? (
          <Button size="sm" variant="secondary" onClick={onStopSimulate}>
            Stop simulation
          </Button>
        ) : (
          <>
            {points.length === 0 && (
              <Button size="sm" variant="secondary" onClick={onStartSimulate} id="drone-simulate-btn">
                Simulate demo
              </Button>
            )}
          </>
        )}
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>

      {/* Instruction hint when no points yet and not simulating */}
      {points.length === 0 && !isSimulating && (
        <p className="text-xs text-(--text-muted)">
          A crosshair cursor is active on the map — click to place each boundary point.
        </p>
      )}

      {/* Save / Finish */}
      {canFinish && !isSimulating && (
        <Button
          size="sm"
          variant="primary"
          className="w-full"
          onClick={handleFinish}
          id="drone-save-plot-btn"
        >
          Save plot ({points.length} points)
        </Button>
      )}
    </div>
  )
}
