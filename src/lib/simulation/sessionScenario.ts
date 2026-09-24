/**
 * Blind vs. Sighted, built from the pilot's own session instead of a
 * scripted demo — see lib/geo/boundary.ts / store/useFieldStore.ts for
 * where `originalBoundary` gets snapshotted once, on import, and never
 * touched again.
 *
 * - "Blind" = the original, uncorrected boundary as first imported, with
 *   a plan generated from it.
 * - "Sighted" = the boundary as it stands right now (whatever corrections
 *   the pilot has actually made), with a plan generated from it.
 * - Ground truth for scoring = the current (Sighted) boundary — a
 *   walked/verified edge is the pilot's own confirmation of what's real,
 *   the same role the old fixed scenario's hidden ground truth played,
 *   just honestly derived instead of scripted.
 *
 * The scoring engine itself (simulateSprayReplay) is untouched — this
 * module only selects its inputs.
 */
import { planSprayPath } from '@/lib/geo/planner'
import { projectAll, type LocalProjection } from '@/lib/geo/projection'
import type { DroneProfile, FieldBoundary, LocalPoint, NoSprayZone, SprayPlan, SweepStrategy } from '@/lib/geo/types'
import { simulateSprayReplay, type ReplayResult } from './replay'

/**
 * Whether `current` has diverged from `original` in any way a
 * walk/trim/accept-risk action would produce — vertex position (a
 * walk/trim splice) or edge provenance (accept-risk, or a walk that
 * only reached some edges). Compared positionally (by index), which is
 * valid here because both arrays start out byte-for-byte identical
 * (originalBoundary is snapshotted as the exact same object the live
 * boundary starts as) and only ever diverge through the delta
 * corrections in lib/geo/delta.ts, never through independent edits to
 * one but not the other.
 */
export function boundaryHasCorrections(original: FieldBoundary, current: FieldBoundary): boolean {
  if (original.vertices.length !== current.vertices.length) return true
  for (let i = 0; i < original.vertices.length; i++) {
    const a = original.vertices[i]
    const b = current.vertices[i]
    if (a.lon !== b.lon || a.lat !== b.lat) return true
  }

  if (original.edges.length !== current.edges.length) return true
  for (let i = 0; i < original.edges.length; i++) {
    const a = original.edges[i].provenance
    const b = current.edges[i].provenance
    if (a.kind !== b.kind || (a.acceptedRisk === true) !== (b.acceptedRisk === true)) return true
  }

  return false
}

export interface SessionBlindVsSighted {
  blindBoundaryLocal: LocalPoint[]
  sightedBoundaryLocal: LocalPoint[]
  groundTruthLocal: LocalPoint[]
  blindPlan: SprayPlan
  sightedPlan: SprayPlan
  blindResult: ReplayResult
  sightedResult: ReplayResult
}

export interface RunSessionBlindVsSightedParams {
  originalBoundary: FieldBoundary
  currentBoundary: FieldBoundary
  noSprayZones: NoSprayZone[]
  droneProfile: DroneProfile
  sweepStrategy: SweepStrategy
  projection: LocalProjection
}

export function runSessionBlindVsSighted(params: RunSessionBlindVsSightedParams): SessionBlindVsSighted {
  const { originalBoundary, currentBoundary, noSprayZones, droneProfile, sweepStrategy, projection } = params

  const blindBoundaryLocal = projectAll(projection, originalBoundary.vertices)
  const sightedBoundaryLocal = projectAll(projection, currentBoundary.vertices)
  // The pilot's current, corrected boundary IS the ground truth for scoring — see module docs.
  const groundTruthLocal = sightedBoundaryLocal
  const noSprayZonesLocal = noSprayZones.map((zone) => projectAll(projection, zone.vertices))

  const blindPlan = planSprayPath({ boundaryLocal: blindBoundaryLocal, noSprayZonesLocal, droneProfile, sweepStrategy })
  const sightedPlan = planSprayPath({ boundaryLocal: sightedBoundaryLocal, noSprayZonesLocal, droneProfile, sweepStrategy })

  const blindResult = simulateSprayReplay({ groundTruthLocal, plan: blindPlan, droneProfile })
  const sightedResult = simulateSprayReplay({ groundTruthLocal, plan: sightedPlan, droneProfile })

  return { blindBoundaryLocal, sightedBoundaryLocal, groundTruthLocal, blindPlan, sightedPlan, blindResult, sightedResult }
}
