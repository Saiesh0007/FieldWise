import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { SAMPLE_FIELD_VERTICES } from '@/lib/geo/sampleField'
import type { LatLng } from '@/lib/geo/types'

// Minimum gap between recorded points, in degrees — filters GPS jitter
// without needing a full metric-projection round trip just to record a
// walk. ~0.000015° is on the order of 1-1.5m depending on latitude.
const MIN_POINT_GAP_DEG = 0.000015

interface GpsWalkCaptureProps {
  onComplete: (vertices: LatLng[]) => void
  onCancel: () => void
  onPointsChange: (points: LatLng[]) => void
}

type CaptureMode = 'idle' | 'real' | 'simulated'

/**
 * Records a boundary by walking its perimeter. Two position sources feed
 * the exact same vertex-accumulation path: real `navigator.geolocation`
 * (for an actual field) or a scripted playback (so the flow is fully
 * demoable without one). This dual-source shape is deliberate — the
 * correction flow's "walk a strip" delta (next pass) needs the same
 * abstraction, so it's built once here rather than reworked later.
 */
export function GpsWalkCapture({ onComplete, onCancel, onPointsChange }: GpsWalkCaptureProps) {
  const [mode, setMode] = useState<CaptureMode>('idle')
  const [points, setPoints] = useState<LatLng[]>([])
  const [error, setError] = useState<string | null>(null)
  const watchIdRef = useRef<number | null>(null)
  const simTimerRef = useRef<number | null>(null)

  useEffect(() => {
    onPointsChange(points)
  }, [points, onPointsChange])

  const addPoint = (p: LatLng) => {
    setPoints((prev) => {
      const last = prev[prev.length - 1]
      if (last && Math.hypot(p.lon - last.lon, p.lat - last.lat) < MIN_POINT_GAP_DEG) return prev
      return [...prev, p]
    })
  }

  const stop = () => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current)
      watchIdRef.current = null
    }
    if (simTimerRef.current !== null) {
      window.clearInterval(simTimerRef.current)
      simTimerRef.current = null
    }
  }

  useEffect(() => stop, []) // stop any active capture on unmount

  const startReal = () => {
    if (!navigator.geolocation) {
      setError('Geolocation is not available in this browser.')
      return
    }
    setError(null)
    setPoints([])
    setMode('real')
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => addPoint({ lon: pos.coords.longitude, lat: pos.coords.latitude }),
      (err) => setError(err.message),
      { enableHighAccuracy: true, maximumAge: 1000 },
    )
  }

  const startSimulated = () => {
    setError(null)
    setPoints([])
    setMode('simulated')
    let i = 0
    // Walking the sample field's own perimeter — a plausible-looking path
    // for the demo, and it means the resulting boundary is directly
    // comparable to the "satellite" version of the same field.
    simTimerRef.current = window.setInterval(() => {
      if (i >= SAMPLE_FIELD_VERTICES.length) {
        stop()
        return
      }
      addPoint(SAMPLE_FIELD_VERTICES[i])
      i++
    }, 350)
  }

  const finish = () => {
    stop()
    if (points.length >= 3) onComplete(points)
  }

  const cancel = () => {
    stop()
    setPoints([])
    setMode('idle')
    onCancel()
  }

  if (mode === 'idle') {
    return (
      <div className="space-y-2 rounded-(--radius-card) border border-(--border-subtle) bg-(--surface-panel) p-3">
        <p className="text-xs text-(--text-secondary)">
          Walk the field perimeter with the pilot's phone GPS, or play a simulated walk for this demo.
        </p>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={startReal}>
            Start real GPS walk
          </Button>
          <Button size="sm" variant="secondary" onClick={startSimulated}>
            Simulate walk (demo)
          </Button>
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
        {error && <p className="text-xs text-danger">{error}</p>}
      </div>
    )
  }

  const waitingForFirstFix = mode === 'real' && points.length === 0 && !error

  return (
    <div className="space-y-2 rounded-(--radius-card) border border-provenance-walked/30 bg-provenance-walked-bg p-3">
      <p className="flex items-center gap-1.5 text-xs font-medium text-provenance-walked">
        {waitingForFirstFix ? (
          <>
            <Spinner /> Waiting for GPS fix…
          </>
        ) : (
          <>
            {mode === 'real' ? 'Recording real GPS walk…' : 'Playing simulated walk…'} {points.length} point
            {points.length === 1 ? '' : 's'} captured
          </>
        )}
      </p>
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" onClick={cancel}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" disabled={points.length < 3} onClick={finish}>
          Finish walk ({points.length})
        </Button>
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  )
}
