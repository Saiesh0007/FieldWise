/**
 * The boustrophedon sweep planner. Ties together heading resolution,
 * no-spray-zone clipping, and tank-aware sortie splitting into a single
 * `planSprayPath` entry point — this is the function the correction flow
 * calls on every edit for the ~1s re-plan, and what the Blind vs. Sighted
 * replay runs twice against different boundaries.
 *
 * Approach: rotate the sprayable area into "sweep space" (sweep direction
 * = +x axis, rows = horizontal lines of constant y), run the scanline
 * even-odd algorithm from math.ts at each row to get one or more spray
 * segments per row (this is what makes concave fields and no-spray zones
 * "just work" — a row that dips into a concavity or crosses a zone comes
 * back as multiple disjoint segments automatically), order the segments
 * boustrophedon-style (alternating direction per row) connected by
 * transit legs, then rotate back to field-local space.
 */
import { splitIntoSorties } from './droneProfile'
import { minTurnsHeadingRad, polygonAreaM2, rotate, scanlineSpans } from './math'
import { multiPolygonAreaM2, subtractNoSprayZones, type LocalPolygon } from './noSprayZones'
import type { DroneProfile, LocalPoint, SprayPass, SprayPlan, SweepStrategy } from './types'

export interface PlanSprayPathParams {
  boundaryLocal: LocalPoint[]
  noSprayZonesLocal: LocalPoint[][]
  droneProfile: DroneProfile
  sweepStrategy: SweepStrategy
  /** Overlap between adjacent passes as a fraction of swath (0.1 = 10% overlap). Defaults to 0. */
  overlapFraction?: number
  /** Launch/refill point; defaults to the boundary's first vertex. */
  homePoint?: LocalPoint
  /**
   * Manual row-spacing override, meters (AeroGCS Green §11.3 "Adjust
   * Spacing") — when set, used directly as the distance between sweep
   * rows instead of the profile-derived `swathM * (1 - overlapFraction)`.
   * Lets a pilot tighten or loosen coverage independent of the drone
   * profile's own swath figure, e.g. to compensate for wind drift.
   */
  spacingOverrideM?: number
}

function resolveHeadingRad(strategy: SweepStrategy, boundaryLocal: LocalPoint[]): number {
  switch (strategy.kind) {
    case 'min-turns':
      return minTurnsHeadingRad(boundaryLocal)
    case 'fixed-heading':
    case 'crop-row':
      return (strategy.headingDeg * Math.PI) / 180
  }
}

function emptyPlan(headingRad: number): SprayPlan {
  return {
    sorties: [],
    totalDistanceM: 0,
    totalVolumeL: 0,
    totalEstimatedMinutes: 0,
    areaHa: 0,
    headingDeg: (headingRad * 180) / Math.PI,
  }
}

export function planSprayPath(params: PlanSprayPathParams): SprayPlan {
  const { boundaryLocal, noSprayZonesLocal, droneProfile, sweepStrategy, overlapFraction = 0 } = params
  if (params.spacingOverrideM !== undefined && params.spacingOverrideM <= 0) {
    throw new Error('spacingOverrideM must be a positive number of meters')
  }
  const homePoint = params.homePoint ?? boundaryLocal[0]

  const headingRad = resolveHeadingRad(sweepStrategy, boundaryLocal)
  const sprayable = subtractNoSprayZones(boundaryLocal, noSprayZonesLocal)
  const areaM2 = multiPolygonAreaM2(sprayable, polygonAreaM2)

  if (areaM2 <= 0 || sprayable.length === 0) {
    return emptyPlan(headingRad)
  }

  // Rotate every ring of every sprayable polygon into sweep space.
  const rotatedPolys: LocalPolygon[] = sprayable.map((poly) => poly.map((ring) => ring.map((p) => rotate(p, -headingRad))))
  const allRotatedPoints = rotatedPolys.flat(2)

  const spacing = params.spacingOverrideM ?? droneProfile.swathM * (1 - overlapFraction)
  const yMin = Math.min(...allRotatedPoints.map((p) => p.y))
  const yMax = Math.max(...allRotatedPoints.map((p) => p.y))

  // Rows of [x0, x1] spans, keyed by row y — a row can carry multiple
  // disjoint spans (a concave dent, or a no-spray zone bisecting it).
  const rowsMap = new Map<number, Array<[number, number]>>()

  // First row half a swath in from the extreme edge so the outermost
  // strip is centered under a pass rather than sitting right at its rim.
  let y = yMin + droneProfile.swathM / 2
  while (y <= yMax - droneProfile.swathM / 2 + 1e-9) {
    for (const poly of rotatedPolys) {
      const spans = scanlineSpans(poly, y)
      if (spans.length > 0) {
        const existing = rowsMap.get(y) ?? []
        rowsMap.set(y, [...existing, ...spans])
      }
    }
    y += spacing
  }

  const rowYs = [...rowsMap.keys()].sort((a, b) => a - b)

  // Boustrophedon ordering: alternate left-to-right / right-to-left per
  // row, connecting every segment (within a row, and between rows) with
  // an explicit transit leg so position tracking stays continuous.
  const orderedRotated: Array<{ start: LocalPoint; end: LocalPoint; spraying: boolean }> = []
  let cursor: LocalPoint | null = null

  rowYs.forEach((rowY, rowIdx) => {
    const segments = [...(rowsMap.get(rowY) ?? [])].sort((a, b) => a[0] - b[0])
    const orderedSegments = rowIdx % 2 === 0 ? segments : [...segments].reverse()

    for (const [x0, x1] of orderedSegments) {
      const [fromX, toX] = rowIdx % 2 === 0 ? [x0, x1] : [x1, x0]
      const start: LocalPoint = { x: fromX, y: rowY }
      const end: LocalPoint = { x: toX, y: rowY }

      if (cursor) {
        orderedRotated.push({ start: cursor, end: start, spraying: false })
      }
      orderedRotated.push({ start, end, spraying: true })
      cursor = end
    }
  })

  // Rotate back to field-local space.
  const passes: SprayPass[] = orderedRotated.map((seg) => ({
    start: rotate(seg.start, headingRad),
    end: rotate(seg.end, headingRad),
    spraying: seg.spraying,
  }))

  const sorties = splitIntoSorties(passes, droneProfile, homePoint)

  return {
    sorties,
    totalDistanceM: sorties.reduce((s, sortie) => s + sortie.distanceM, 0),
    totalVolumeL: sorties.reduce((s, sortie) => s + sortie.volumeL, 0),
    totalEstimatedMinutes: sorties.reduce((s, sortie) => s + sortie.estimatedMinutes, 0),
    areaHa: areaM2 / 10_000,
    headingDeg: (headingRad * 180) / Math.PI,
  }
}

/**
 * "Move Plan" (AeroGCS Green §11.7) — shifts every pass in an already-
 * generated plan by a fixed local-meter offset, without touching the
 * boundary, zones, or re-running the planner. A pure geometric
 * translation: distances, areas, sortie/volume/time totals are all
 * unchanged by a shift, so only each pass's start/end move.
 */
export function translateSprayPlan(plan: SprayPlan, offset: LocalPoint): SprayPlan {
  if (offset.x === 0 && offset.y === 0) return plan

  const shift = (p: LocalPoint): LocalPoint => ({ x: p.x + offset.x, y: p.y + offset.y })

  return {
    ...plan,
    sorties: plan.sorties.map((sortie) => ({
      ...sortie,
      passes: sortie.passes.map((pass) => ({ ...pass, start: shift(pass.start), end: shift(pass.end) })),
    })),
  }
}

/**
 * The mission's actual start point — where the flight path begins (the
 * first pass's start point), not necessarily the boundary's first
 * vertex. Null for an empty plan (e.g. a fully-excluded field).
 */
export function planStartPoint(plan: SprayPlan): LocalPoint | null {
  return plan.sorties[0]?.passes[0]?.start ?? null
}

/** The mission's actual finish point — the last pass's end point, in the last sortie. Null for an empty plan. */
export function planFinishPoint(plan: SprayPlan): LocalPoint | null {
  const lastSortie = plan.sorties[plan.sorties.length - 1]
  const lastPass = lastSortie?.passes[lastSortie.passes.length - 1]
  return lastPass?.end ?? null
}

export interface PlanSplit {
  /** The portion of the route this sortie is meant to fly (AeroGCS Green's "yellow" line). */
  included: SprayPass[]
  /** The portion deferred to a later battery/sortie ("blue" line) — not flown this pass. */
  excluded: SprayPass[]
}

/**
 * "Plan Splitting" (AeroGCS Green §11.8) — lets a pilot manually mark
 * the first (or last) `percent`% of the plan's passes, by pass count
 * in flight order across every sortie, as the portion to actually fly
 * this battery, deferring the rest. Purely a display/upload-subset
 * split on an already-generated plan — it doesn't recompute sorties,
 * tank volumes, or timing, since a partial flight's own battery/tank
 * accounting is a separate concern from "which passes."
 */
export function splitPlanPasses(plan: SprayPlan, percent: number, fromEnd: boolean): PlanSplit {
  const allPasses = plan.sorties.flatMap((sortie) => sortie.passes)
  if (percent >= 100 || allPasses.length === 0) return { included: allPasses, excluded: [] }
  if (percent <= 0) return { included: [], excluded: allPasses }

  const cutCount = Math.round((allPasses.length * percent) / 100)
  return fromEnd
    ? { included: allPasses.slice(allPasses.length - cutCount), excluded: allPasses.slice(0, allPasses.length - cutCount) }
    : { included: allPasses.slice(0, cutCount), excluded: allPasses.slice(cutCount) }
}
