/**
 * Pure geometry for Simulate's flight-path preview — turns a plan's
 * passes into a cumulative-distance path, and answers "where is the
 * drone, and which way is it facing, after flying `distanceM` of it."
 * No React, no timers: SimulatePanel owns the animation clock and calls
 * `poseAtDistance` once per tick.
 */
import { distance, lerpPoint } from '@/lib/geo/math'
import type { LocalPoint, SprayPass } from '@/lib/geo/types'

export interface FlightPathPoint {
  point: LocalPoint
  distFromStartM: number
}

/** Flattens passes into a deduplicated, cumulative-distance vertex list — the same "shared endpoint" merge `sprayPlanToWaypoints` does, so the preview's path matches what's actually uploaded. */
export function buildFlightPath(passes: SprayPass[]): FlightPathPoint[] {
  const points: LocalPoint[] = []
  for (const pass of passes) {
    const last = points[points.length - 1]
    if (!last || last.x !== pass.start.x || last.y !== pass.start.y) points.push(pass.start)
    points.push(pass.end)
  }

  const path: FlightPathPoint[] = []
  let cumulative = 0
  points.forEach((p, i) => {
    if (i > 0) cumulative += distance(points[i - 1], p)
    path.push({ point: p, distFromStartM: cumulative })
  })
  return path
}

export function totalFlightPathLengthM(path: FlightPathPoint[]): number {
  return path[path.length - 1]?.distFromStartM ?? 0
}

export interface FlightPreviewPose {
  point: LocalPoint
  /** Compass bearing, degrees, 0 = north, clockwise — matches `VFR_HUD.heading` and `HeadingCompass`'s convention. */
  headingDeg: number
}

/**
 * The drone's position and heading after flying `distanceM` along `path`,
 * clamped to the path's own length. Heading is held over from whichever
 * leg contains that point (a zero-length leg — two coincident vertices —
 * keeps the previous heading rather than reporting a meaningless 0).
 */
export function poseAtDistance(path: FlightPathPoint[], distanceM: number): FlightPreviewPose | null {
  if (path.length === 0) return null
  if (path.length === 1) return { point: path[0].point, headingDeg: 0 }

  const total = path[path.length - 1].distFromStartM
  const clamped = Math.max(0, Math.min(distanceM, total))

  let segIndex = 1
  while (segIndex < path.length - 1 && path[segIndex].distFromStartM < clamped) segIndex++

  const from = path[segIndex - 1]
  const to = path[segIndex]
  const segLength = to.distFromStartM - from.distFromStartM
  const t = segLength > 1e-9 ? (clamped - from.distFromStartM) / segLength : 0
  const point = lerpPoint(from.point, to.point, t)

  const dx = to.point.x - from.point.x
  const dy = to.point.y - from.point.y
  const headingDeg = segLength > 1e-9 ? ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360 : 0

  return { point, headingDeg }
}
