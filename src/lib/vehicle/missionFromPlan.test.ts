import { describe, expect, it } from 'vitest'
import { createLocalProjection } from '@/lib/geo/projection'
import type { LatLng, SprayPass } from '@/lib/geo/types'
import { sprayPlanToWaypoints } from './missionFromPlan'
import { MAV_CMD_NAV_WAYPOINT } from './mavlink/messages'

const ORIGIN: LatLng = { lon: 75.75, lat: 30.35 }
const projection = createLocalProjection(ORIGIN)

const passes: SprayPass[] = [
  { start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, spraying: true },
  { start: { x: 100, y: 0 }, end: { x: 100, y: 10 }, spraying: false }, // transit, shares an endpoint with the previous pass
  { start: { x: 100, y: 10 }, end: { x: 0, y: 10 }, spraying: true },
]

describe('sprayPlanToWaypoints', () => {
  it('flattens consecutive passes into a deduplicated, contiguously-numbered waypoint list', () => {
    const waypoints = sprayPlanToWaypoints(passes, projection, 3)

    // 3 passes chained end-to-end share endpoints, so there are 4 distinct points, not 6.
    expect(waypoints).toHaveLength(4)
    expect(waypoints.map((w) => w.seq)).toEqual([0, 1, 2, 3])
    for (const wp of waypoints) {
      expect(wp.altM).toBe(3)
      expect(wp.command).toBe(MAV_CMD_NAV_WAYPOINT)
    }
  })

  it('renumbers from 0 for an arbitrary subset of passes, not the full plan — what Plan Splitting relies on', () => {
    const subset = [passes[2]] // only the last pass, as splitPlanPasses's `included` might hand over
    const waypoints = sprayPlanToWaypoints(subset, projection, 3)

    expect(waypoints).toHaveLength(2)
    expect(waypoints[0].seq).toBe(0)
    expect(waypoints[1].seq).toBe(1)
    expect(waypoints[0].position.lat).toBeCloseTo(projection.toLatLng(subset[0].start).lat, 9)
    expect(waypoints[1].position.lat).toBeCloseTo(projection.toLatLng(subset[0].end).lat, 9)
  })

  it('returns an empty list for an empty pass array (e.g. Plan Splitting at 0%)', () => {
    expect(sprayPlanToWaypoints([], projection, 3)).toEqual([])
  })

  it('does not deduplicate a start that only coincidentally matches an earlier end at a later, non-adjacent pass', () => {
    // A spray leg loops back through a point it already visited (a real
    // boustrophedon pattern with a shared transit-back point) — that
    // shared coordinate isn't adjacent in the list, so it must not be
    // collapsed away; only adjacent (previous-end === this-start) pairs
    // are deduplicated. The loop-back leg sits strictly between two
    // spraying legs, not at either end, so trimming doesn't touch it.
    const loopingPasses: SprayPass[] = [
      { start: { x: 0, y: 0 }, end: { x: 50, y: 0 }, spraying: true },
      { start: { x: 50, y: 0 }, end: { x: 0, y: 0 }, spraying: false },
      { start: { x: 0, y: 0 }, end: { x: 25, y: 0 }, spraying: true },
    ]
    const waypoints = sprayPlanToWaypoints(loopingPasses, projection, 3)
    // (0,0) -> (50,0)==next start, merged -> (0,0) [revisited, not merged since non-adjacent] -> (25,0): 4 distinct points.
    expect(waypoints).toHaveLength(4)
  })

  it('drops a leading and/or trailing run of transit-only passes — the out-from-home and return-to-home legs every sortie is bookended with', () => {
    // splitIntoSorties always opens a sortie with a transit leg from the
    // home/refill point and closes it with one back to home; uploading
    // those as real waypoints would make the mission auto-fly home at
    // the end, which is now RTL's job (a deliberate pilot action), not
    // something scripted into the route.
    const withHomeLegs: SprayPass[] = [
      { start: { x: -20, y: -20 }, end: { x: 0, y: 0 }, spraying: false }, // out from home
      { start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, spraying: true },
      { start: { x: 100, y: 0 }, end: { x: -20, y: -20 }, spraying: false }, // back to home
    ]
    const waypoints = sprayPlanToWaypoints(withHomeLegs, projection, 3)

    expect(waypoints).toHaveLength(2)
    expect(waypoints[0].position.lat).toBeCloseTo(projection.toLatLng({ x: 0, y: 0 }).lat, 9)
    expect(waypoints[1].position.lat).toBeCloseTo(projection.toLatLng({ x: 100, y: 0 }).lat, 9)
  })

  it('returns an empty list when every pass is a transit leg (nothing to spray this subset)', () => {
    const onlyTransit: SprayPass[] = [{ start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, spraying: false }]
    expect(sprayPlanToWaypoints(onlyTransit, projection, 3)).toEqual([])
  })
})
