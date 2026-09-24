import { useEffect, useState } from 'react'
import { DroneProfilePicker } from '@/components/panels/DroneProfilePicker'
import { Button } from '@/components/ui/Button'
import { StatCard } from '@/components/ui/StatCard'
import { planFinishPoint, planStartPoint, splitPlanPasses } from '@/lib/geo/planner'
import { useFieldStore } from '@/store/useFieldStore'

interface PlanPanelProps {
  cropRowTapActive: boolean
  onStartCropRowTap: () => void
  onCancelCropRowTap: () => void
}

const MIN_SPACING_M = 2
const MAX_SPACING_M = 10
const MOVE_PLAN_STEP_M = 1

/** The card treatment every editing section below shares — matches Send to Vehicle's Live Telemetry/Flight Controls boxes, so the two sidebars read consistently. */
const SECTION_CARD = 'space-y-2 rounded-(--radius-card) border border-(--border-subtle) bg-(--surface-panel) p-3'

export function PlanPanel({ cropRowTapActive, onStartCropRowTap, onCancelCropRowTap }: PlanPanelProps) {
  const boundary = useFieldStore((s) => s.boundary)
  const sprayPlan = useFieldStore((s) => s.sprayPlan)
  const planError = useFieldStore((s) => s.planError)
  const droneProfile = useFieldStore((s) => s.droneProfile)
  const sweepStrategy = useFieldStore((s) => s.sweepStrategy)
  const setSweepStrategy = useFieldStore((s) => s.setSweepStrategy)
  const headLock = useFieldStore((s) => s.headLock)
  const setHeadLock = useFieldStore((s) => s.setHeadLock)
  const spacingOverrideM = useFieldStore((s) => s.spacingOverrideM)
  const setSpacingOverrideM = useFieldStore((s) => s.setSpacingOverrideM)
  const planOffsetLocal = useFieldStore((s) => s.planOffsetLocal)
  const movePlan = useFieldStore((s) => s.movePlan)
  const resetPlanOffset = useFieldStore((s) => s.resetPlanOffset)
  const planSplitPercent = useFieldStore((s) => s.planSplitPercent)
  const planSplitDirection = useFieldStore((s) => s.planSplitDirection)
  const setPlanSplitPercent = useFieldStore((s) => s.setPlanSplitPercent)
  const setPlanSplitDirection = useFieldStore((s) => s.setPlanSplitDirection)
  const resetPlanSplit = useFieldStore((s) => s.resetPlanSplit)
  const setStep = useFieldStore((s) => s.setStep)
  const lastRecomputeMs = useFieldStore((s) => s.lastRecomputeMs)

  const [headingInput, setHeadingInput] = useState(
    sweepStrategy.kind === 'min-turns' ? '0' : String(sweepStrategy.headingDeg),
  )

  // Keep the input in sync when the heading changes from outside this
  // input (e.g. a crop-row tap on the map sets sweepStrategy directly).
  useEffect(() => {
    if (sweepStrategy.kind !== 'min-turns') {
      setHeadingInput(sweepStrategy.headingDeg.toFixed(1))
    }
  }, [sweepStrategy])

  if (!boundary) {
    return <div className="p-4 text-sm text-(--text-secondary)">No field loaded yet — go back to Import.</div>
  }

  const sprayPassCount = sprayPlan ? sprayPlan.sorties.reduce((sum, s) => sum + s.passes.filter((p) => p.spraying).length, 0) : 0
  const isFixedOrCropRow = sweepStrategy.kind === 'fixed-heading' || sweepStrategy.kind === 'crop-row'
  const startPoint = sprayPlan ? planStartPoint(sprayPlan) : null
  const finishPoint = sprayPlan ? planFinishPoint(sprayPlan) : null
  const split = sprayPlan ? splitPlanPasses(sprayPlan, planSplitPercent, planSplitDirection) : null
  const splitStats = { includedCount: split?.included.length ?? 0, totalCount: (split?.included.length ?? 0) + (split?.excluded.length ?? 0) }

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <div>
        <h2 className="text-sm font-semibold text-(--text-primary)">Spray path plan</h2>
        <p className="mt-1 text-xs text-(--text-secondary)">
          Solid lines are spray passes; dashed lines are transit/return-to-refill legs.
        </p>
      </div>

      {sprayPlan ? (
        <div className="grid grid-cols-2 gap-2.5">
          <StatCard label="Sorties" value={String(sprayPlan.sorties.length)} hint={`${droneProfile.tankL}L tank`} />
          <StatCard label="Chemical" value={sprayPlan.totalVolumeL.toFixed(1)} unit="L" />
          <StatCard label="Flight time" value={sprayPlan.totalEstimatedMinutes.toFixed(1)} unit="min" />
          <StatCard label="Distance" value={(sprayPlan.totalDistanceM / 1000).toFixed(2)} unit="km" />
          <StatCard label="Area" value={sprayPlan.areaHa.toFixed(2)} unit="ha" />
          <StatCard label="Sweep heading" value={sprayPlan.headingDeg.toFixed(0)} unit="°" hint={`${sprayPassCount} passes`} />
        </div>
      ) : (
        <div className="rounded-(--radius-card) border border-danger/30 bg-danger-bg p-3 text-sm text-danger">
          Couldn't plan a spray path{planError ? ` — ${planError}` : '.'} Fix the drone profile below.
        </div>
      )}
      {lastRecomputeMs !== null && <div className="text-[11px] text-(--text-muted)">Re-planned in {lastRecomputeMs.toFixed(1)}ms</div>}

      <div className={SECTION_CARD}>
        <DroneProfilePicker />
      </div>

      <section className={SECTION_CARD}>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-(--text-muted)">Route adjust — heading</h3>
        <div className="flex items-center gap-2">
          <label className="flex cursor-pointer items-center gap-1.5 text-sm text-(--text-primary)">
            <input
              type="radio"
              className="h-3.5 w-3.5 accent-brand-600"
              checked={sweepStrategy.kind === 'min-turns'}
              onChange={() => setSweepStrategy({ kind: 'min-turns' })}
            />
            Auto (min-turns)
          </label>
          <label className="flex cursor-pointer items-center gap-1.5 text-sm text-(--text-primary)">
            <input
              type="radio"
              className="h-3.5 w-3.5 accent-brand-600"
              checked={isFixedOrCropRow}
              onChange={() => setSweepStrategy({ kind: 'fixed-heading', headingDeg: Number(headingInput) || 0 })}
            />
            Fixed / crop-row
          </label>
        </div>
        {isFixedOrCropRow && (
          <>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={0}
                max={360}
                step={1}
                className="flex-1"
                value={Number(headingInput) || 0}
                onChange={(e) => {
                  setHeadingInput(e.target.value)
                  setSweepStrategy({ kind: 'fixed-heading', headingDeg: Number(e.target.value) })
                }}
              />
              <input
                type="number"
                className="w-20 rounded-(--radius-control) border border-(--border-subtle) bg-(--surface-panel) px-2 py-1 text-sm transition-colors focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
                value={headingInput}
                onChange={(e) => {
                  setHeadingInput(e.target.value)
                  setSweepStrategy({ kind: 'fixed-heading', headingDeg: Number(e.target.value) || 0 })
                }}
              />
              <span className="text-xs text-(--text-muted)">° from east, CCW</span>
            </div>
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-(--text-secondary)">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 accent-brand-600"
                checked={headLock}
                onChange={(e) => setHeadLock(e.target.checked)}
              />
              Head lock — keep the drone's heading fixed during flight, rather than turning to face each pass
            </label>
          </>
        )}
        {sweepStrategy.kind === 'crop-row' && (
          <p className="text-xs text-provenance-walked">Set by tapping a crop row on the map.</p>
        )}
        {cropRowTapActive ? (
          <Button size="sm" variant="secondary" onClick={onCancelCropRowTap}>
            Cancel tap
          </Button>
        ) : (
          <Button size="sm" variant="secondary" onClick={onStartCropRowTap}>
            Tap crop-row heading on map
          </Button>
        )}
      </section>

      <section className={SECTION_CARD}>
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-(--text-muted)">Adjust spacing</h3>
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-(--text-secondary)">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 accent-brand-600"
              checked={spacingOverrideM !== null}
              onChange={(e) => setSpacingOverrideM(e.target.checked ? droneProfile.swathM : null)}
            />
            Override
          </label>
        </div>
        {spacingOverrideM !== null ? (
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={MIN_SPACING_M}
              max={MAX_SPACING_M}
              step={0.5}
              className="flex-1"
              value={spacingOverrideM}
              onChange={(e) => setSpacingOverrideM(Number(e.target.value))}
            />
            <span className="w-14 shrink-0 text-right text-xs tabular-nums text-(--text-primary)">{spacingOverrideM.toFixed(1)}m</span>
          </div>
        ) : (
          <p className="text-xs text-(--text-muted)">Using the drone profile's swath: {droneProfile.swathM.toFixed(1)}m between rows.</p>
        )}
      </section>

      <section className={SECTION_CARD}>
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-(--text-muted)">Move plan</h3>
          {(planOffsetLocal.x !== 0 || planOffsetLocal.y !== 0) && (
            <button type="button" className="text-xs text-danger hover:underline" onClick={resetPlanOffset}>
              Reset
            </button>
          )}
        </div>
        <div className="grid w-fit grid-cols-3 gap-1">
          <div />
          <Button size="sm" variant="secondary" onClick={() => movePlan(0, MOVE_PLAN_STEP_M)} aria-label="Move plan north">
            ↑
          </Button>
          <div />
          <Button size="sm" variant="secondary" onClick={() => movePlan(-MOVE_PLAN_STEP_M, 0)} aria-label="Move plan west">
            ←
          </Button>
          <div />
          <Button size="sm" variant="secondary" onClick={() => movePlan(MOVE_PLAN_STEP_M, 0)} aria-label="Move plan east">
            →
          </Button>
          <div />
          <Button size="sm" variant="secondary" onClick={() => movePlan(0, -MOVE_PLAN_STEP_M)} aria-label="Move plan south">
            ↓
          </Button>
          <div />
        </div>
        <p className="text-xs text-(--text-muted)">
          Displacement: {planOffsetLocal.x.toFixed(1)}m east, {planOffsetLocal.y.toFixed(1)}m north
        </p>
      </section>

      <section className={SECTION_CARD}>
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-(--text-muted)">Plan splitting</h3>
          {planSplitPercent < 100 && (
            <button type="button" className="text-xs text-danger hover:underline" onClick={resetPlanSplit}>
              Reset
            </button>
          )}
        </div>
        <p className="text-xs text-(--text-secondary)">
          Fly only part of the route this battery, deferring the rest to a later sortie — the intended route draws
          in yellow on the map, the deferred portion in blue.
        </p>
        <div className="flex gap-2">
          <label className="flex flex-1 cursor-pointer items-center gap-1.5 text-xs text-(--text-primary)">
            <input
              type="radio"
              className="h-3.5 w-3.5 accent-brand-600"
              checked={planSplitDirection === 'from-start'}
              onChange={() => setPlanSplitDirection('from-start')}
            />
            From start
          </label>
          <label className="flex flex-1 cursor-pointer items-center gap-1.5 text-xs text-(--text-primary)">
            <input
              type="radio"
              className="h-3.5 w-3.5 accent-brand-600"
              checked={planSplitDirection === 'from-end'}
              onChange={() => setPlanSplitDirection('from-end')}
            />
            From end
          </label>
          <label className="flex flex-1 cursor-pointer items-center gap-1.5 text-xs text-(--text-primary)">
            <input
              type="radio"
              className="h-3.5 w-3.5 accent-brand-600"
              checked={planSplitDirection === 'from-both'}
              onChange={() => setPlanSplitDirection('from-both')}
            />
            Both sides
          </label>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            className="flex-1"
            value={planSplitPercent}
            onChange={(e) => setPlanSplitPercent(Number(e.target.value))}
          />
          <span className="w-10 shrink-0 text-right text-xs tabular-nums text-(--text-primary)">{planSplitPercent}%</span>
        </div>
        {sprayPlan && planSplitPercent < 100 && (
          <p className="text-xs text-(--text-muted)">
            {splitStats.includedCount} of {splitStats.totalCount} passes included this sortie.
          </p>
        )}
      </section>

      {sprayPlan && (startPoint || finishPoint) && (
        <section className={SECTION_CARD}>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-(--text-muted)">Start &amp; finish</h3>
          <p className="text-xs text-(--text-secondary)">
            Both marked in green on the map — <span className="font-semibold">S</span> where the flight path
            begins, <span className="font-semibold">F</span> where it ends and the mission is complete.
          </p>
        </section>
      )}

      <div className="mt-auto pt-2">
        <Button variant="primary" className="w-full" disabled={!sprayPlan} onClick={() => setStep('simulate')}>
          Continue to Simulate
        </Button>
      </div>
    </div>
  )
}
