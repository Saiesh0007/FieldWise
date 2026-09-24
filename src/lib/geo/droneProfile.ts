/**
 * Drone/tank math: converting spray-pass geometry into liters and time,
 * and splitting an ordered pass list into tank-limited sorties with
 * refill legs. Pure functions over plain geometry — no knowledge of the
 * boundary, no-spray zones, or heading resolution, which all live in
 * planner.ts.
 */
import { distance, lerpPoint } from './math'
import type { DroneProfile, LocalPoint, Sortie, SprayPass } from './types'

export function assertValidProfile(profile: DroneProfile): void {
  if (profile.swathM <= 0) throw new Error('Drone profile: swathM must be > 0')
  if (profile.tankL <= 0) throw new Error('Drone profile: tankL must be > 0')
  if (profile.applicationRateLPerHa <= 0) throw new Error('Drone profile: applicationRateLPerHa must be > 0')
  if (profile.speedMps <= 0) throw new Error('Drone profile: speedMps must be > 0')
}

export function passVolumeL(lengthM: number, swathM: number, rateLPerHa: number): number {
  const areaM2 = lengthM * swathM
  return (areaM2 / 10_000) * rateLPerHa
}

function passTimeSec(lengthM: number, speedMps: number, spraying: boolean, turnPenaltySec: number): number {
  const travelSec = lengthM / speedMps
  // Transit legs (between disjoint spray segments, or out to/back from a
  // refill) incur the same per-maneuver turn penalty a pass-end turn does.
  return spraying ? travelSec : travelSec + turnPenaltySec
}

/** Theoretical max coverage rate at cruise speed, ignoring turns/transit — a headline "X ha/hr" stat. */
export function coverageRateHaPerHour(profile: DroneProfile): number {
  const metersPerHour = profile.speedMps * 3600
  return (metersPerHour * profile.swathM) / 10_000
}

/**
 * Splits an ordered pass list (spray legs + transit legs, as produced by
 * the boustrophedon planner) into tank-limited sorties. Handles the case
 * where the tank runs out *mid-pass* by splitting that pass at the exact
 * point capacity is exhausted, closing the sortie with a return-to-home
 * leg, and opening the next sortie with an out-to-resume leg — so total
 * distance/time correctly include the refill round trip.
 */
export function splitIntoSorties(passes: SprayPass[], profile: DroneProfile, homePoint: LocalPoint): Sortie[] {
  assertValidProfile(profile)

  const sorties: Sortie[] = []

  let current: SprayPass[] = []
  let currentDistance = 0
  let currentVolume = 0
  let currentTimeSec = 0
  let sortieIndex = 0
  let position: LocalPoint = homePoint

  const pushTransit = (to: LocalPoint) => {
    const legLength = distance(position, to)
    if (legLength > 1e-6) {
      current.push({ start: position, end: to, spraying: false })
      currentDistance += legLength
      currentTimeSec += passTimeSec(legLength, profile.speedMps, false, profile.turnPenaltySec)
    }
    position = to
  }

  const closeSortie = () => {
    if (current.length === 0) return
    pushTransit(homePoint) // return to the refill point to close out the sortie
    sorties.push({
      index: sortieIndex++,
      passes: current,
      distanceM: currentDistance,
      volumeL: currentVolume,
      estimatedMinutes: currentTimeSec / 60,
    })
    current = []
    currentDistance = 0
    currentVolume = 0
    currentTimeSec = 0
    position = homePoint
  }

  for (const pass of passes) {
    if (!pass.spraying) {
      pushTransit(pass.end)
      continue
    }

    pushTransit(pass.start) // walk out to the pass start (first pass of a sortie, or resume-after-refill)

    let segStart = pass.start
    let remainingLengthM = distance(pass.start, pass.end)

    while (remainingLengthM > 1e-6) {
      const remainingTankL = profile.tankL - currentVolume
      const maxAffordableLengthM = (remainingTankL * 10_000) / (profile.swathM * profile.applicationRateLPerHa)

      if (maxAffordableLengthM >= remainingLengthM - 1e-9) {
        // The rest of this pass fits in the current tank.
        current.push({ start: segStart, end: pass.end, spraying: true })
        currentDistance += remainingLengthM
        currentVolume += passVolumeL(remainingLengthM, profile.swathM, profile.applicationRateLPerHa)
        currentTimeSec += passTimeSec(remainingLengthM, profile.speedMps, true, profile.turnPenaltySec)
        position = pass.end
        remainingLengthM = 0
      } else if (maxAffordableLengthM <= 1e-9) {
        // Tank already full — close out and retry this same remaining segment on a fresh tank.
        closeSortie()
        pushTransit(segStart)
      } else {
        // Tank runs out partway through this pass — split it exactly there.
        const t = maxAffordableLengthM / remainingLengthM
        const splitPoint = lerpPoint(segStart, pass.end, t)
        current.push({ start: segStart, end: splitPoint, spraying: true })
        currentDistance += maxAffordableLengthM
        currentVolume += passVolumeL(maxAffordableLengthM, profile.swathM, profile.applicationRateLPerHa)
        currentTimeSec += passTimeSec(maxAffordableLengthM, profile.speedMps, true, profile.turnPenaltySec)
        position = splitPoint
        segStart = splitPoint
        remainingLengthM -= maxAffordableLengthM
        closeSortie()
        pushTransit(segStart) // out to resume the split pass on the next sortie
      }
    }
  }

  closeSortie()

  return sorties
}
