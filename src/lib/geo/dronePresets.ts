import { DEFAULT_DRONE_PROFILE } from './defaults'
import type { DroneProfile } from './types'

/**
 * A small set of vendor-neutral starting points for the drone-profile
 * picker — named generically on purpose (this app is explicitly
 * hardware-agnostic, not tied to one manufacturer's spec sheet). The
 * pilot can pick one as a starting point and then freely edit any field;
 * editing marks the profile 'custom' (see DroneProfilePicker).
 */
export const DRONE_PRESETS: DroneProfile[] = [
  DEFAULT_DRONE_PROFILE,
  {
    id: 'heavy-agri-16l',
    name: 'Heavy Agri Spray (16L)',
    swathM: 6,
    speedMps: 6,
    tankL: 16,
    applicationRateLPerHa: 12,
    altitudeM: 3,
    enduranceMin: 8,
    turnPenaltySec: 6,
  },
  {
    id: 'light-scout-5l',
    name: 'Light Scout Spray (5L)',
    swathM: 3,
    speedMps: 4,
    tankL: 5,
    applicationRateLPerHa: 18,
    altitudeM: 2,
    enduranceMin: 10,
    turnPenaltySec: 5,
  },
]
