import { useEffect, useRef } from 'react'
import { SAMPLE_FIELD_VERTICES } from '@/lib/geo/sampleField'
import type { LatLng } from '@/lib/geo/types'

// Auto-plays the sample field vertices at drone-speed pace, accumulating
// points into the parent's dronePoints array via onPointsUpdate. Uses a
// ref for the accumulator so the interval doesn't go stale.
const DRONE_FLY_INTERVAL_MS = 550

/**
 * The "Simulate demo" auto-play for the Drone plot-creation method — lets
 * it be demoed without a real drone by walking the sample field's own
 * vertices on a timer. Split into its own file (not exported alongside
 * DronePointCapture, the component that uses it) so that component file
 * only exports a component, which is what Vite's Fast Refresh requires
 * to hot-reload it without a full page reload.
 */
export function useDroneSimulation(
  enabled: boolean,
  /** Called once per simulated vertex, with ALL points so far (safe to pass directly to onDronePointsChange). */
  onPointsUpdate: (allPoints: LatLng[]) => void,
  onDone: () => void,
) {
  const timerRef = useRef<number | null>(null)
  const indexRef = useRef(0)
  const accumulatedRef = useRef<LatLng[]>([])

  useEffect(() => {
    if (!enabled) {
      if (timerRef.current !== null) {
        window.clearInterval(timerRef.current)
        timerRef.current = null
      }
      indexRef.current = 0
      accumulatedRef.current = []
      return
    }

    // Reset accumulator for this simulation run
    indexRef.current = 0
    accumulatedRef.current = []

    timerRef.current = window.setInterval(() => {
      const i = indexRef.current
      if (i >= SAMPLE_FIELD_VERTICES.length) {
        if (timerRef.current !== null) {
          window.clearInterval(timerRef.current)
          timerRef.current = null
        }
        onDone()
        return
      }
      accumulatedRef.current = [...accumulatedRef.current, SAMPLE_FIELD_VERTICES[i]]
      onPointsUpdate(accumulatedRef.current)
      indexRef.current = i + 1
    }, DRONE_FLY_INTERVAL_MS)

    return () => {
      if (timerRef.current !== null) {
        window.clearInterval(timerRef.current)
        timerRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onPointsUpdate and onDone are stable useCallback refs from parent
  }, [enabled])
}
