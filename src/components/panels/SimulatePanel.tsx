import clsx from 'clsx'
import { useEffect, useMemo, useState } from 'react'
import type { SimulateOverlay } from '@/components/map/FieldMap'
import { Button } from '@/components/ui/Button'
import { StatCard } from '@/components/ui/StatCard'
import type { LocalProjection } from '@/lib/geo/projection'
import type { LatLng } from '@/lib/geo/types'
import { PROVENANCE_COLORS } from '@/lib/map/provenanceColors'
import { buildFlightPath, poseAtDistance, totalFlightPathLengthM } from '@/lib/simulation/flightPreview'
import { boundaryHasCorrections, runSessionBlindVsSighted, type SessionBlindVsSighted } from '@/lib/simulation/sessionScenario'
import type { ReplayResult } from '@/lib/simulation/replay'
import { trimBookendingTransitLegs } from '@/lib/vehicle/missionFromPlan'
import { useFieldStore } from '@/store/useFieldStore'

interface SimulatePanelProps {
  onOverlayChange: (overlay: SimulateOverlay | null) => void
  /** Flight-path preview's drone marker position — null while nothing is being previewed (e.g. no plan, or the pilot navigated away from Simulate). */
  onDronePositionChange: (position: { lat: number; lon: number; headingDeg: number } | null) => void
}

type ReplayView = 'blind' | 'sighted'

const ANIMATION_TICK_MS = 70
/** How long a full start-to-finish preview takes, regardless of the route's real length — a 13km plan flown at drone speed would take the better part of an hour, which isn't useful as an on-screen preview. */
const FLIGHT_PREVIEW_DURATION_S = 18

interface SessionScenario extends SessionBlindVsSighted {
  groundTruthLatLng: LatLng[]
  blindLatLng: LatLng[]
  sightedLatLng: LatLng[]
  projection: LocalProjection
}

export function SimulatePanel({ onOverlayChange, onDronePositionChange }: SimulatePanelProps) {
  const boundary = useFieldStore((s) => s.boundary)
  const originalBoundary = useFieldStore((s) => s.originalBoundary)
  const noSprayZones = useFieldStore((s) => s.noSprayZones)
  const droneProfile = useFieldStore((s) => s.droneProfile)
  const sweepStrategy = useFieldStore((s) => s.sweepStrategy)
  const projection = useFieldStore((s) => s.projection)
  const sprayPlan = useFieldStore((s) => s.sprayPlan)

  const [scenario, setScenario] = useState<SessionScenario | null>(null)
  const [view, setView] = useState<ReplayView>('blind')
  const [step, setStep] = useState(0)
  const [playing, setPlaying] = useState(false)

  // Flight-path preview — the drone flying the actual planned route
  // (Start to Finish, the same trimmed passes the mission itself
  // uploads), independent of the Blind vs. Sighted replay above.
  const flightPath = useMemo(() => {
    if (!sprayPlan) return []
    return buildFlightPath(trimBookendingTransitLegs(sprayPlan.sorties.flatMap((s) => s.passes)))
  }, [sprayPlan])
  const flightPathLengthM = totalFlightPathLengthM(flightPath)
  const [previewDistanceM, setPreviewDistanceM] = useState(0)
  const [previewPlaying, setPreviewPlaying] = useState(false)

  // A fresh plan (a re-plan, or a brand-new field) restarts the preview
  // from Start and auto-plays it — "the drone must move from start to
  // finish" is the default behavior, not something the pilot has to ask for.
  useEffect(() => {
    setPreviewDistanceM(0)
    setPreviewPlaying(flightPathLengthM > 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the plan identity, not flightPathLengthM itself (recomputed every render otherwise)
  }, [sprayPlan])

  useEffect(() => {
    if (!previewPlaying) return
    if (previewDistanceM >= flightPathLengthM) {
      setPreviewPlaying(false)
      return
    }
    const perTickM = flightPathLengthM / ((FLIGHT_PREVIEW_DURATION_S * 1000) / ANIMATION_TICK_MS)
    const timer = setTimeout(() => setPreviewDistanceM((d) => Math.min(d + perTickM, flightPathLengthM)), ANIMATION_TICK_MS)
    return () => clearTimeout(timer)
  }, [previewPlaying, previewDistanceM, flightPathLengthM])

  // Push the drone's current position/heading up to FieldMap.
  useEffect(() => {
    if (!projection || flightPath.length === 0) {
      onDronePositionChange(null)
      return
    }
    const pose = poseAtDistance(flightPath, previewDistanceM)
    if (!pose) {
      onDronePositionChange(null)
      return
    }
    const { lon, lat } = projection.toLatLng(pose.point)
    onDronePositionChange({ lat, lon, headingDeg: pose.headingDeg })
  }, [flightPath, previewDistanceM, projection, onDronePositionChange])

  // Clear the drone marker if the pilot navigates away from this step.
  useEffect(() => () => onDronePositionChange(null), [onDronePositionChange])

  const handlePreviewPlayPause = () => {
    if (!previewPlaying && previewDistanceM >= flightPathLengthM) {
      setPreviewDistanceM(0) // "Replay" — restart from Start rather than sitting stuck at Finish
    }
    setPreviewPlaying((p) => !p)
  }
  // Brake — a manual, single-tap way to stop the preview where it stands, matching the real Brake button's intent (Alt Hold in place).
  const handlePreviewBrake = () => setPreviewPlaying(false)
  // RTL — returns the previewed drone to the launch/start point, matching the real RTL button's intent.
  const handlePreviewRtl = () => {
    setPreviewPlaying(false)
    setPreviewDistanceM(0)
  }

  const hasCorrections = boundary && originalBoundary ? boundaryHasCorrections(originalBoundary, boundary) : false

  const activeResult: ReplayResult | null = scenario ? (view === 'blind' ? scenario.blindResult : scenario.sightedResult) : null
  const totalPasses = activeResult?.heatmap.totalPasses ?? 0

  const runScenario = () => {
    if (!boundary || !originalBoundary || !projection) return
    const result = runSessionBlindVsSighted({
      originalBoundary,
      currentBoundary: boundary,
      noSprayZones,
      droneProfile,
      sweepStrategy,
      projection,
    })
    setScenario({
      ...result,
      groundTruthLatLng: boundary.vertices,
      blindLatLng: originalBoundary.vertices,
      sightedLatLng: boundary.vertices,
      projection,
    })
    setView('blind')
    setStep(0)
    setPlaying(true)
  }

  // A live boundary edit (a new correction, or a brand-new import)
  // invalidates whatever scenario is currently displayed — clear it
  // rather than let the panel keep showing results that no longer match
  // the pilot's actual session.
  useEffect(() => {
    setScenario(null)
    setPlaying(false)
    setStep(0)
  }, [boundary])

  const switchView = (next: ReplayView) => {
    setView(next)
    setStep(0)
    setPlaying(true)
  }

  // Progressive reveal: advance one spraying pass at a time until the run finishes.
  useEffect(() => {
    if (!playing) return
    if (step >= totalPasses) {
      setPlaying(false)
      return
    }
    const timer = setTimeout(() => setStep((s) => s + 1), ANIMATION_TICK_MS)
    return () => clearTimeout(timer)
  }, [playing, step, totalPasses])

  // Push what FieldMap should render up to App.tsx whenever the scenario, view, or animation step changes.
  useEffect(() => {
    if (!scenario || !activeResult) {
      onOverlayChange(null)
      return
    }
    onOverlayChange({
      groundTruthLatLng: scenario.groundTruthLatLng,
      activeBoundaryLatLng: view === 'blind' ? scenario.blindLatLng : scenario.sightedLatLng,
      activeColor: view === 'blind' ? PROVENANCE_COLORS.satellite : PROVENANCE_COLORS.walked,
      heatmap: activeResult.heatmap,
      projection: scenario.projection,
      revealedThroughStep: step,
    })
  }, [scenario, activeResult, view, step, onOverlayChange])

  // Clear the overlay if the pilot navigates away from this step.
  useEffect(() => () => onOverlayChange(null), [onOverlayChange])

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      {sprayPlan && flightPathLengthM > 0 && (
        <>
          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-(--text-primary)">Flight preview</h2>
            <p className="mt-1 text-xs text-(--text-secondary)">
              The blue arrow flies the planned route, Start to Finish — the same intended path (yellow, in Plan)
              this plan would actually upload.
            </p>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="secondary" onClick={handlePreviewPlayPause}>
                {previewPlaying ? 'Pause' : previewDistanceM >= flightPathLengthM ? 'Replay' : 'Play'}
              </Button>
              <Button size="sm" variant="secondary" disabled={!previewPlaying} onClick={handlePreviewBrake}>
                Brake
              </Button>
              <Button size="sm" variant="danger" onClick={handlePreviewRtl}>
                RTL
              </Button>
              <input
                type="range"
                min={0}
                max={Math.max(flightPathLengthM, 1)}
                value={previewDistanceM}
                onChange={(e) => {
                  setPreviewPlaying(false)
                  setPreviewDistanceM(Number(e.target.value))
                }}
                className="flex-1"
              />
            </div>
            <p className="text-xs text-(--text-muted)">
              {previewDistanceM.toFixed(0)} / {flightPathLengthM.toFixed(0)} m flown
            </p>
          </section>

          <div className="h-px bg-(--border-subtle)" />
        </>
      )}

      <div>
        <h2 className="text-sm font-semibold text-(--text-primary)">Blind vs. Sighted replay</h2>
        <p className="mt-1 text-xs text-(--text-secondary)">
          Compares your field's original boundary against your corrected boundary — same drone profile, two plans,
          scored against the boundary you actually confirmed in Verify.
        </p>
      </div>

      {!boundary ? (
        <p className="text-sm text-(--text-secondary)">No field loaded yet — import or load a field in the Import step first.</p>
      ) : !hasCorrections ? (
        <p className="text-sm text-(--text-secondary)">
          No corrections made yet — walk or trim at least one edge in Verify to see the difference.
        </p>
      ) : !scenario ? (
        <Button variant="primary" onClick={runScenario}>
          Run replay
        </Button>
      ) : (
        <>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => switchView('blind')}
              className={clsx(
                'flex-1 rounded-(--radius-control) border px-3 py-2 text-sm font-medium transition-colors',
                view === 'blind' ? 'border-provenance-satellite bg-provenance-satellite-bg text-provenance-satellite' : 'border-(--border-subtle) text-(--text-secondary)',
              )}
            >
              Blind (satellite-only)
            </button>
            <button
              type="button"
              onClick={() => switchView('sighted')}
              className={clsx(
                'flex-1 rounded-(--radius-control) border px-3 py-2 text-sm font-medium transition-colors',
                view === 'sighted' ? 'border-provenance-walked bg-provenance-walked-bg text-provenance-walked' : 'border-(--border-subtle) text-(--text-secondary)',
              )}
            >
              Sighted (corrected)
            </button>
          </div>

          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => setPlaying((p) => !p)} disabled={step >= totalPasses && !playing}>
              {playing ? 'Pause' : step >= totalPasses ? 'Done' : 'Play'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setStep(0); setPlaying(true) }}>
              Replay
            </Button>
            <input
              type="range"
              min={0}
              max={Math.max(totalPasses, 1)}
              value={step}
              onChange={(e) => {
                setPlaying(false)
                setStep(Number(e.target.value))
              }}
              className="flex-1"
            />
            <span className="w-14 shrink-0 text-right text-xs tabular-nums text-(--text-muted)">
              {step}/{totalPasses}
            </span>
          </div>

          {activeResult && (
            <div className="grid grid-cols-2 gap-2.5">
              <StatCard label="Coverage" value={activeResult.coveragePct.toFixed(1)} unit="%" />
              <StatCard label="Overspray" value={activeResult.oversprayPct.toFixed(1)} unit="%" />
              <StatCard label="Chemical wasted" value={activeResult.wastedLiters.toFixed(2)} unit="L" />
              <StatCard label="Cost wasted" value={`₹${activeResult.wastedCostInr.toFixed(0)}`} />
            </div>
          )}

          <div className="flex items-center gap-3 text-xs text-(--text-muted)">
            <span className="flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: '#16a34a' }} /> covered
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: '#dc2626' }} /> missed
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: '#f97316' }} /> overspray
            </span>
          </div>

          <div className="h-px bg-(--border-subtle)" />

          <section className="space-y-1.5">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-(--text-muted)">Blind vs. Sighted</h3>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-(--text-muted)">
                  <th className="pb-1 font-normal"> </th>
                  <th className="pb-1 font-normal">Coverage</th>
                  <th className="pb-1 font-normal">Overspray</th>
                  <th className="pb-1 font-normal">Wasted</th>
                </tr>
              </thead>
              <tbody>
                <tr className={clsx(view === 'blind' && 'font-semibold text-provenance-satellite')}>
                  <td className="py-0.5">Blind</td>
                  <td>{scenario.blindResult.coveragePct.toFixed(1)}%</td>
                  <td>{scenario.blindResult.oversprayPct.toFixed(1)}%</td>
                  <td>₹{scenario.blindResult.wastedCostInr.toFixed(0)}</td>
                </tr>
                <tr className={clsx(view === 'sighted' && 'font-semibold text-provenance-walked')}>
                  <td className="py-0.5">Sighted</td>
                  <td>{scenario.sightedResult.coveragePct.toFixed(1)}%</td>
                  <td>{scenario.sightedResult.oversprayPct.toFixed(1)}%</td>
                  <td>₹{scenario.sightedResult.wastedCostInr.toFixed(0)}</td>
                </tr>
              </tbody>
            </table>
          </section>

          <Button size="sm" variant="ghost" onClick={runScenario}>
            Re-run with current drone profile
          </Button>
        </>
      )}
    </div>
  )
}
