/**
 * The Blind vs. Sighted replay's scoring engine: given a hidden ground
 * truth boundary and a spray plan (built from either the stale
 * satellite boundary or the corrected one), replays every spray pass
 * against a metric grid and reports what actually landed where —
 * coverage of the real field, overspray onto whatever's outside it, and
 * the chemical/cost that overspray wastes. Pure function, no React, no
 * store — the two calls the Simulate panel makes (one for Blind, one for
 * Sighted) are the whole interface.
 *
 * Approach: rasterize a square grid over the area, classify each cell as
 * inside/outside the ground truth (pointInPolygon), then walk the plan's
 * spraying passes in order and mark which cells fall within the pass's
 * swath footprint — a flush rectangle along the flight line (the pass's
 * own length x swath width), not a rounded "capsule" that would bleed a
 * semicircle of false overspray past every pass's endpoint even when it
 * ends exactly on a shared boundary edge. The first pass to reach a cell
 * "claims" it (doseOrder), which is what lets the UI reveal the heatmap
 * in pass order instead of just showing a static end state.
 */
import { pointInPolygon, polygonAreaM2 } from '@/lib/geo/math'
import type { DroneProfile, LocalPoint, SprayPlan } from '@/lib/geo/types'

/** Illustrative placeholder — not a sourced commodity price. Swap for a real per-product price if this ever needs to be accurate rather than demonstrative. */
export const DEFAULT_CHEMICAL_COST_PER_LITER_INR = 250

export type HeatmapCellState = 'covered' | 'missed' | 'overspray'

export interface HeatmapCell {
  /** Cell center, local meters. */
  cx: number
  cy: number
  state: HeatmapCellState
  /** Index (in spraying-pass order) of the pass that first dosed this cell; null for 'missed' cells, which no pass ever reached. */
  doseOrder: number | null
}

export interface ReplayHeatmap {
  cellSizeM: number
  cells: HeatmapCell[]
  /** Number of spraying passes in the plan — the animation's step count upper bound. */
  totalPasses: number
}

export interface ReplayResult {
  groundTruthAreaHa: number
  coveredAreaHa: number
  missedAreaHa: number
  oversprayAreaHa: number
  /** % of the ground-truth field's own area that got sprayed. */
  coveragePct: number
  /** % of the ground-truth field's own area, sprayed a SECOND time outside its boundary — i.e. overspray expressed on the same scale as coverage, so the two read side by side. */
  oversprayPct: number
  /** Chemical applied outside the real boundary — genuinely wasted (and, in the field, drifted onto whatever's next door). */
  wastedLiters: number
  wastedCostInr: number
  heatmap: ReplayHeatmap
}

export interface SimulateReplayParams {
  groundTruthLocal: LocalPoint[]
  plan: SprayPlan
  droneProfile: DroneProfile
  /** Grid resolution for the heatmap/scoring rasterization. Finer = more accurate, slower; 2m is a reasonable default relative to typical swath widths (3-8m). */
  cellSizeM?: number
  chemicalCostPerLiterInr?: number
}

function boundsOf(points: LocalPoint[]): { minX: number; maxX: number; minY: number; maxY: number } {
  return {
    minX: Math.min(...points.map((p) => p.x)),
    maxX: Math.max(...points.map((p) => p.x)),
    minY: Math.min(...points.map((p) => p.y)),
    maxY: Math.max(...points.map((p) => p.y)),
  }
}

export function simulateSprayReplay(params: SimulateReplayParams): ReplayResult {
  const { groundTruthLocal, plan, droneProfile } = params
  const cellSizeM = params.cellSizeM ?? 2
  const chemicalCostPerLiterInr = params.chemicalCostPerLiterInr ?? DEFAULT_CHEMICAL_COST_PER_LITER_INR

  if (cellSizeM <= 0) throw new Error('cellSizeM must be > 0')
  if (groundTruthLocal.length < 3) throw new Error('groundTruthLocal needs at least 3 vertices')

  const sprayingPasses = plan.sorties.flatMap((sortie) => sortie.passes).filter((pass) => pass.spraying)

  // Grid covers ground truth plus every spray pass endpoint (with a
  // margin), so cells sprayed outside the ground truth are still inside
  // the grid and get classified as overspray rather than falling off
  // the edge of the raster entirely.
  const allPoints = [...groundTruthLocal, ...sprayingPasses.flatMap((p) => [p.start, p.end])]
  const bounds = allPoints.length > 0 ? boundsOf(allPoints) : boundsOf(groundTruthLocal)
  const halfSwath = droneProfile.swathM / 2
  const margin = cellSizeM * 2 + halfSwath
  // A grid origin derived purely from the boundary's own bounds can put a
  // cell center exactly ON a polygon edge whenever the boundary is built
  // from round numbers relative to cellSizeM (an axis-aligned test/demo
  // rectangle at 2m spacing is a common way to hit this; a real
  // GPS-derived boundary practically never has exact-round coordinates,
  // so this doesn't come up there). Ground-truth's inside test and the
  // spray-dosing test are each individually correct but use different
  // boundary conventions (see pointInPolygon's half-open edges vs the
  // dosing rectangle's inclusive edges), so a point sitting exactly on a
  // shared edge between the two can be classified inside by one and
  // outside by the other — a fixed fractional offset on the grid origin
  // means that almost never happens for anything but a maliciously
  // constructed input.
  const GRID_ORIGIN_JITTER = 0.31
  const minX = bounds.minX - margin + GRID_ORIGIN_JITTER * cellSizeM
  const minY = bounds.minY - margin + GRID_ORIGIN_JITTER * cellSizeM
  const cols = Math.max(1, Math.ceil((bounds.maxX + margin - minX) / cellSizeM))
  const rows = Math.max(1, Math.ceil((bounds.maxY + margin - minY) / cellSizeM))

  const inside = new Uint8Array(cols * rows)
  const doseOrder = new Int32Array(cols * rows).fill(-1)

  const cellCenter = (col: number, row: number): LocalPoint => ({
    x: minX + (col + 0.5) * cellSizeM,
    y: minY + (row + 0.5) * cellSizeM,
  })

  // A field boundary and a grid both built from round numbers can put a
  // cell center exactly ON an edge (a shared boundary between the ground
  // truth and the plan's own boundary is a common, not edge-case, way
  // this happens). The even-odd ray-casting test is only well-defined
  // for points strictly off every edge, so nudge the sample point by a
  // tiny fixed epsilon before testing — cheap, standard practice for
  // this class of algorithm, and it keeps pointInPolygon itself a plain,
  // textbook implementation rather than special-casing boundary ties.
  const GRID_EPSILON = 1e-6

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const { x, y } = cellCenter(col, row)
      if (pointInPolygon({ x: x + GRID_EPSILON, y: y + GRID_EPSILON }, groundTruthLocal)) {
        inside[row * cols + col] = 1
      }
    }
  }

  sprayingPasses.forEach((pass, passIndex) => {
    const dx = pass.end.x - pass.start.x
    const dy = pass.end.y - pass.start.y
    const passLength = Math.hypot(dx, dy)
    // Unit vectors along the flight line and perpendicular to it, so the
    // footprint test below is a flush rectangle (length x swath), not a
    // rounded capsule.
    const alongX = passLength > 0 ? dx / passLength : 1
    const alongY = passLength > 0 ? dy / passLength : 0
    const perpX = -alongY
    const perpY = alongX

    const pad = halfSwath + cellSizeM
    const colMin = Math.max(0, Math.floor((Math.min(pass.start.x, pass.end.x) - pad - minX) / cellSizeM))
    const colMax = Math.min(cols - 1, Math.ceil((Math.max(pass.start.x, pass.end.x) + pad - minX) / cellSizeM))
    const rowMin = Math.max(0, Math.floor((Math.min(pass.start.y, pass.end.y) - pad - minY) / cellSizeM))
    const rowMax = Math.min(rows - 1, Math.ceil((Math.max(pass.start.y, pass.end.y) + pad - minY) / cellSizeM))

    for (let row = rowMin; row <= rowMax; row++) {
      for (let col = colMin; col <= colMax; col++) {
        const idx = row * cols + col
        if (doseOrder[idx] !== -1) continue // already dosed by an earlier pass — first pass claims the cell
        const { x: cx, y: cy } = cellCenter(col, row)
        const relX = cx - pass.start.x
        const relY = cy - pass.start.y
        const along = relX * alongX + relY * alongY
        const perp = relX * perpX + relY * perpY
        if (along >= 0 && along <= passLength && Math.abs(perp) <= halfSwath) {
          doseOrder[idx] = passIndex
        }
      }
    }
  })

  const cells: HeatmapCell[] = []
  let coveredCells = 0
  let missedCells = 0
  let oversprayCells = 0
  let insideCells = 0

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const idx = row * cols + col
      const isInside = inside[idx] === 1
      const dosed = doseOrder[idx] !== -1
      if (isInside) insideCells++

      if (isInside && dosed) {
        coveredCells++
        const { x: cx, y: cy } = cellCenter(col, row)
        cells.push({ cx, cy, state: 'covered', doseOrder: doseOrder[idx] })
      } else if (isInside && !dosed) {
        missedCells++
        const { x: cx, y: cy } = cellCenter(col, row)
        cells.push({ cx, cy, state: 'missed', doseOrder: null })
      } else if (!isInside && dosed) {
        oversprayCells++
        const { x: cx, y: cy } = cellCenter(col, row)
        cells.push({ cx, cy, state: 'overspray', doseOrder: doseOrder[idx] })
      }
      // outside & never dosed: not interesting, not rendered, not counted.
    }
  }

  const cellAreaM2 = cellSizeM * cellSizeM
  const groundTruthAreaHa = polygonAreaM2(groundTruthLocal) / 10_000
  const coveredAreaHa = (coveredCells * cellAreaM2) / 10_000
  const missedAreaHa = (missedCells * cellAreaM2) / 10_000
  const oversprayAreaHa = (oversprayCells * cellAreaM2) / 10_000

  const coveragePct = insideCells > 0 ? (coveredCells / insideCells) * 100 : 0
  const oversprayPct = insideCells > 0 ? (oversprayCells / insideCells) * 100 : 0

  // Same rate math as the planner (lib/geo/droneProfile.ts's passVolumeL:
  // area × L/ha) applied to the overspray area instead of a pass strip —
  // not a new cost model, just that formula run on a different area.
  const wastedLiters = oversprayAreaHa * droneProfile.applicationRateLPerHa
  const wastedCostInr = wastedLiters * chemicalCostPerLiterInr

  return {
    groundTruthAreaHa,
    coveredAreaHa,
    missedAreaHa,
    oversprayAreaHa,
    coveragePct,
    oversprayPct,
    wastedLiters,
    wastedCostInr,
    heatmap: { cellSizeM, cells, totalPasses: sprayingPasses.length },
  }
}
