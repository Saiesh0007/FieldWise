/**
 * Flattens a list of spray/transit passes into a flat MAVLink waypoint
 * list for upload, with fresh contiguous sequence numbers starting at 0
 * — the mission protocol requires that regardless of which passes were
 * handed in, so this works identically whether the caller passes every
 * pass in a SprayPlan or only the "included" subset from
 * `splitPlanPasses` (Plan Splitting, AeroGCS Green §11.8): the upload
 * itself never needs to know a split happened, only which passes to
 * send.
 *
 * Drops a leading and/or trailing run of non-spraying (transit) passes
 * before converting: `splitIntoSorties` (droneProfile.ts) always opens a
 * sortie with a transit leg out from the home/refill point and closes it
 * with one back to home, so the mission would otherwise auto-fly back to
 * the launch point as its own last scripted waypoint. That's not what a
 * pilot expects from an uploaded route — coming home is a deliberate RTL
 * mode change (see SendPanel's RTL button), not something baked silently
 * into the mission. A transit leg strictly *between* two spraying legs
 * (e.g. crossing a no-spray zone, or a disjoint concave segment) is left
 * alone — only the outermost bookending legs are dropped.
 *
 * Known simplification: this sends every remaining leg (spray and
 * transit alike) as a plain NAV_WAYPOINT at a constant altitude — it
 * does not emit a servo/relay command to turn the actual sprayer on and
 * off at spray-leg boundaries, since that's payload-specific (which
 * output pin, which PWM values) and out of scope for this pass. The
 * boundary/coverage geometry uploads and reads back correctly;
 * actuating the sprayer from the mission is a follow-up, not something
 * this function claims to do.
 */
import type { LocalProjection } from '@/lib/geo/projection'
import type { SprayPass } from '@/lib/geo/types'
import { MAV_CMD_NAV_WAYPOINT } from './mavlink/messages'
import type { MissionWaypoint } from './types'

/**
 * Exported for Simulate's flight-path preview (`flightPreview.ts`), which
 * animates a drone marker over the same trimmed route this function
 * uploads — so the preview shows the same start/finish the mission and
 * the Plan panel's S/F markers agree on, not the raw pass list with its
 * home-bookending transit legs.
 */
export function trimBookendingTransitLegs(passes: SprayPass[]): SprayPass[] {
  let start = 0
  let end = passes.length
  while (start < end && !passes[start].spraying) start++
  while (end > start && !passes[end - 1].spraying) end--
  return passes.slice(start, end)
}

export function sprayPlanToWaypoints(allPasses: SprayPass[], projection: LocalProjection, altitudeM: number): MissionWaypoint[] {
  const passes = trimBookendingTransitLegs(allPasses)
  const localPoints: { x: number; y: number }[] = []

  for (const pass of passes) {
    const last = localPoints[localPoints.length - 1]
    if (!last || last.x !== pass.start.x || last.y !== pass.start.y) {
      localPoints.push(pass.start)
    }
    localPoints.push(pass.end)
  }

  return localPoints.map((p, seq) => ({
    seq,
    position: projection.toLatLng(p),
    altM: altitudeM,
    command: MAV_CMD_NAV_WAYPOINT,
  }))
}
