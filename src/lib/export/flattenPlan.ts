/**
 * Flattens a SprayPlan's passes into an ordered LatLng waypoint list,
 * de-duplicating a pass's start point when it's identical to the
 * previous pass's end (consecutive passes share a vertex at every
 * boustrophedon turn). Shared by every vehicle-facing export in this
 * folder (QGC .plan, Mission Planner .waypoints, CSV) so they all walk
 * the same point sequence — the same rule lib/vehicle/missionFromPlan.ts
 * uses for the live Web-Serial upload, kept as a separate copy there
 * since that module already shipped and is protocol-tested independently.
 */
import type { LocalProjection } from '@/lib/geo/projection'
import type { LatLng, SprayPlan } from '@/lib/geo/types'

export function flattenPlanToLatLngPoints(plan: SprayPlan, projection: LocalProjection): LatLng[] {
  const points: LatLng[] = []
  let lastLocal: { x: number; y: number } | null = null

  for (const sortie of plan.sorties) {
    for (const pass of sortie.passes) {
      if (!lastLocal || lastLocal.x !== pass.start.x || lastLocal.y !== pass.start.y) {
        points.push(projection.toLatLng(pass.start))
      }
      points.push(projection.toLatLng(pass.end))
      lastLocal = pass.end
    }
  }

  return points
}
