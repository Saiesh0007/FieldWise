/**
 * QGroundControl `.plan` file export — QGC's native mission format, a
 * plain JSON document (`fileType: "Plan"`, mission schema version 2).
 * Every mission item here is a MAV_CMD_NAV_WAYPOINT (16) on
 * MAV_FRAME_GLOBAL_RELATIVE_ALT (3), matching what the real Web-Serial
 * upload path sends (lib/vehicle/missionFromPlan.ts) — same simplification
 * applies: this uploads the coverage geometry, not a servo/relay command
 * to actuate the sprayer.
 *
 * Verification status: this schema was written from documented QGC
 * `.plan` field names/structure, not from a real QGroundControl install
 * (none is available in this sandboxed dev environment to open the file
 * in). It's checked here only by structural inspection and this file's
 * own unit tests (valid JSON, correct field shapes/types, doJumpId
 * sequencing). Before relying on this for a live demo, open the
 * generated file in an actual copy of QGroundControl once to confirm it
 * imports cleanly.
 */
import { flattenPlanToLatLngPoints } from './flattenPlan'
import type { LocalProjection } from '@/lib/geo/projection'
import type { SprayPlan } from '@/lib/geo/types'

const MAV_CMD_NAV_WAYPOINT = 16
const MAV_FRAME_GLOBAL_RELATIVE_ALT = 3

export interface QgcPlanItem {
  autoContinue: boolean
  command: number
  doJumpId: number
  frame: number
  params: [number, number, number, number | null, number, number, number]
  type: 'SimpleItem'
}

export interface QgcPlan {
  fileType: 'Plan'
  geoFence: { circles: unknown[]; polygons: unknown[]; version: number }
  groundStation: 'QGroundControl'
  mission: {
    cruiseSpeed: number
    firmwareType: number
    globalPlanAltitudeMode: number
    hoverSpeed: number
    items: QgcPlanItem[]
    plannedHomePosition: [number, number, number]
    vehicleType: number
    version: number
  }
  rallyPoints: { points: unknown[]; version: number }
  version: number
}

export function buildQgcPlan(plan: SprayPlan, projection: LocalProjection, altitudeM: number, cruiseSpeedMps: number): QgcPlan {
  const points = flattenPlanToLatLngPoints(plan, projection)
  if (points.length === 0) {
    throw new Error('buildQgcPlan: spray plan has no waypoints to export.')
  }

  const home = points[0]

  const items: QgcPlanItem[] = points.map((p, i) => ({
    autoContinue: true,
    command: MAV_CMD_NAV_WAYPOINT,
    doJumpId: i + 1,
    frame: MAV_FRAME_GLOBAL_RELATIVE_ALT,
    params: [0, 0, 0, null, p.lat, p.lon, altitudeM],
    type: 'SimpleItem',
  }))

  return {
    fileType: 'Plan',
    geoFence: { circles: [], polygons: [], version: 2 },
    groundStation: 'QGroundControl',
    mission: {
      cruiseSpeed: cruiseSpeedMps,
      firmwareType: 3, // MAV_AUTOPILOT_ARDUPILOTMEGA
      globalPlanAltitudeMode: 1, // relative altitude
      hoverSpeed: 5,
      items,
      plannedHomePosition: [home.lat, home.lon, altitudeM],
      vehicleType: 2, // MAV_TYPE_QUADROTOR
      version: 2,
    },
    rallyPoints: { points: [], version: 2 },
    version: 1,
  }
}

export function buildQgcPlanJson(plan: SprayPlan, projection: LocalProjection, altitudeM: number, cruiseSpeedMps: number): string {
  return JSON.stringify(buildQgcPlan(plan, projection, altitudeM, cruiseSpeedMps), null, 2)
}
