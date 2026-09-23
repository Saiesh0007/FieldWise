/**
 * VehicleLink is the hardware-agnostic contract everything above it
 * (the Send-to-Vehicle panel, and later the Blind vs. Sighted replay)
 * talks to. WebSerialVehicle (Pixhawk over USB, straight from the
 * browser) and PiRelayVehicle (Pixhawk -> Raspberry Pi -> WebSocket,
 * for a setup with no telemetry radio where the Pi is only reachable
 * over SSH — see bridge/README.md) are the two implementations; a
 * SimVehicle (no hardware required) is the no-hardware demo fallback
 * that doesn't exist yet — see the project status notes. No UI code
 * should ever import WebSerialVehicle or PiRelayVehicle directly; it
 * should only ever hold a `VehicleLink`.
 */
import type { LatLng } from '@/lib/geo/types'

export type GpsFixType = 'no-gps' | 'no-fix' | '2d' | '3d' | 'dgps' | 'rtk-float' | 'rtk-fixed' | 'static' | 'unknown'

export interface VehicleTelemetry {
  /** True once a heartbeat has been seen recently; see heartbeatAgeMs. */
  heartbeatOk: boolean
  /** ms since the last heartbeat was received, or null if none seen yet. */
  heartbeatAgeMs: number | null
  gps: {
    fixType: GpsFixType
    satellites: number | null
    /** Horizontal dilution of precision, ×100 as MAVLink reports it, already divided back to a plain ratio. */
    hdop: number | null
    position: LatLng | null
  }
  attitude: {
    rollDeg: number
    pitchDeg: number
    yawDeg: number
  } | null
  /** From HEARTBEAT — the vehicle's own top-level status (MAV_STATE), independent of flight mode. Null until the first heartbeat arrives. */
  systemStatus: string | null
  /** From HEARTBEAT.custom_mode — ArduCopter mode name (see ARDUCOPTER_MODE_LABELS). Null until the first heartbeat arrives, or if custom_mode isn't enabled/recognized. */
  flightMode: string | null
  /** From HEARTBEAT.base_mode's MAV_MODE_FLAG_SAFETY_ARMED bit. Null until the first heartbeat arrives. */
  armed: boolean | null
  /**
   * The 0-indexed sequence number of the most recent waypoint the
   * vehicle reports reaching (MISSION_ITEM_REACHED) — i.e. its live
   * progress through whatever mission is currently loaded onboard, not
   * necessarily the plan this session most recently uploaded. Null
   * until the vehicle sends one. Reaching the last index of the
   * mission this session uploaded is what "the finish point being
   * reached, mission 100% complete" means in practice — see
   * SendPanel.tsx.
   */
  lastReachedWaypointSeq: number | null
  /** From SYS_STATUS — null until that message has been seen at least once (it's not sent on every heartbeat cycle by every autopilot). */
  battery: {
    voltageV: number | null
    /** -1 (MAVLink's "unknown" sentinel) is normalized to null here rather than displayed as -1%. */
    remainingPct: number | null
  } | null
  /** From VFR_HUD.alt — relative-to-home altitude, meters. Null until that message has been seen. */
  altitudeM: number | null
  /** From VFR_HUD.heading — compass heading, degrees. Null until that message has been seen. */
  headingDeg: number | null
  /**
   * From the ArduPilot-legacy WIND message — not part of the shared
   * `common` dialect, and not every ArduCopter configuration emits it.
   * Stays null for the whole session on vehicles that never send it,
   * same as a genuinely-absent HDOP does — never invented.
   */
  wind: {
    speedMps: number
    directionDeg: number
  } | null
}

export const EMPTY_TELEMETRY: VehicleTelemetry = {
  heartbeatOk: false,
  heartbeatAgeMs: null,
  gps: { fixType: 'unknown', satellites: null, hdop: null, position: null },
  attitude: null,
  systemStatus: null,
  flightMode: null,
  armed: null,
  lastReachedWaypointSeq: null,
  battery: null,
  altitudeM: null,
  headingDeg: null,
  wind: null,
}

/** One mission waypoint, in the vehicle-native form (MAV_CMD + a position). Altitude is relative-to-home, meters. */
export interface MissionWaypoint {
  seq: number
  position: LatLng
  altM: number
  /** MAV_CMD id — this project only ever sends MAV_CMD_NAV_WAYPOINT (16). */
  command: number
}

export interface MissionUploadResult {
  uploadedCount: number
  /** The mission read back from the vehicle immediately after upload, for verification. */
  readBack: MissionWaypoint[]
  /** True only if every waypoint's position/altitude round-tripped within tolerance. */
  verified: boolean
  mismatches: Array<{ seq: number; reason: string }>
}

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error'

export interface VehicleLinkEvents {
  onTelemetry: (telemetry: VehicleTelemetry) => void
  onConnectionStateChange: (state: ConnectionState) => void
  /** Non-fatal, human-readable protocol/transport events worth surfacing in a log (a rejected mission item, a retry, a parse error). */
  onLog: (message: string) => void
}

/** The flight-mode changes Route Adjust's Brake/Resume/Land/RTL buttons command — kept as a small named set, not a raw ArduCopter mode number, so the UI and this interface stay autopilot-detail-free. */
export type FlightModeCommand = 'alt-hold' | 'auto' | 'land' | 'rtl'

export interface VehicleLink {
  readonly kind: string

  connect(): Promise<void>
  disconnect(): Promise<void>
  getConnectionState(): ConnectionState

  /** Uploads a mission (the standard MAVLink COUNT -> per-item REQUEST/ITEM handshake -> ACK), then downloads it back and diffs it against what was sent. */
  uploadAndVerifyMission(waypoints: MissionWaypoint[]): Promise<MissionUploadResult>

  /** Arms or disarms via MAV_CMD_COMPONENT_ARM_DISARM, resolving only once the vehicle's COMMAND_ACK confirms it (rejects with the vehicle's reason otherwise — most commonly a failed pre-arm safety check). */
  armDisarm(arm: boolean): Promise<void>
  /** Brake ("alt-hold"), Resume ("auto" — resumes the loaded mission from its current waypoint), Land, or RTL (flies back to and lands at the home/launch point — ArduCopter's own auto return, not a scripted mission waypoint). Resolves once the vehicle's own next HEARTBEAT reflects the new mode (ArduPilot doesn't ACK the legacy SET_MODE message), rejects on timeout if it never does. */
  setFlightMode(mode: FlightModeCommand): Promise<void>

  onTelemetry(listener: VehicleLinkEvents['onTelemetry']): () => void
  onConnectionStateChange(listener: VehicleLinkEvents['onConnectionStateChange']): () => void
  onLog(listener: VehicleLinkEvents['onLog']): () => void
}
