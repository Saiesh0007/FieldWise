import type { DroneProfile } from './types'

/**
 * A generic agri-spray quadcopter profile (values in the range typical of
 * e.g. DJI Agras / XAG-class hardware) used until the pilot picks or edits
 * a profile. Kept vendor-neutral on purpose — the app is hardware-agnostic.
 */
export const DEFAULT_DRONE_PROFILE: DroneProfile = {
  id: 'generic-agri-10l',
  name: 'Generic Agri Spray (10L)',
  swathM: 4,
  speedMps: 5,
  tankL: 10,
  applicationRateLPerHa: 15,
  altitudeM: 2.5,
  enduranceMin: 9,
  turnPenaltySec: 6,
}
