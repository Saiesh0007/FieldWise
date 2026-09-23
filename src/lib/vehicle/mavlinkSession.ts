/**
 * The MAVLink session logic — heartbeat handling, telemetry decoding,
 * and the mission upload/download handshake — factored out from
 * WebSerialVehicle so it can be driven by any byte transport. In the
 * browser that transport is a real Web Serial port; in
 * mavlinkSession.test.ts it's an in-memory loopback that plays a
 * simulated vehicle, which is what makes the mission-protocol state
 * machine below testable without real hardware. WebSerialVehicle is a
 * thin adapter that only knows how to open a serial port and pipe bytes
 * in and out of this class — see its file for what's still
 * hardware-only and unverified.
 */
import { encodeFrame, MavlinkFrameReader, type DecodedFrame } from './mavlink/codec'
import {
  ARDUCOPTER_MODE_ALT_HOLD,
  ARDUCOPTER_MODE_AUTO,
  ARDUCOPTER_MODE_LABELS,
  ARDUCOPTER_MODE_LAND,
  ATTITUDE,
  COMMAND_ACK,
  COMMAND_LONG,
  GLOBAL_POSITION_INT,
  GPS_RAW_INT,
  HEARTBEAT,
  MAV_AUTOPILOT_INVALID,
  MAV_CMD_COMPONENT_ARM_DISARM,
  MAV_FRAME_GLOBAL_RELATIVE_ALT_INT,
  MAV_MISSION_ACCEPTED,
  MAV_MODE_FLAG_CUSTOM_MODE_ENABLED,
  MAV_MODE_FLAG_SAFETY_ARMED,
  MAV_RESULT_ACCEPTED,
  MAV_STATE_ACTIVE,
  MAV_STATE_LABELS,
  MAV_TYPE_GCS,
  MISSION_ACK,
  MISSION_COUNT,
  MISSION_ITEM_INT,
  MISSION_ITEM_REACHED,
  MISSION_REQUEST,
  MISSION_REQUEST_INT,
  MISSION_REQUEST_LIST,
  SET_MODE,
  SYS_STATUS,
  VFR_HUD,
  WIND,
} from './mavlink/messages'
import type { FlightModeCommand, MissionUploadResult, MissionWaypoint, VehicleLinkEvents, VehicleTelemetry } from './types'
import { EMPTY_TELEMETRY } from './types'

const FLIGHT_MODE_CUSTOM_NUMBER: Record<FlightModeCommand, number> = {
  'alt-hold': ARDUCOPTER_MODE_ALT_HOLD,
  auto: ARDUCOPTER_MODE_AUTO,
  land: ARDUCOPTER_MODE_LAND,
}

// Our (the GCS's) own MAVLink identity. 255 is the conventional GCS
// system id; component id 190 (MAV_COMP_ID_MISSIONPLANNER-ish range) is
// an arbitrary-but-conventional choice for a ground-station-like tool.
export const GCS_SYSID = 255
export const GCS_COMPID = 190

export const HEARTBEAT_STALE_MS = 5000
export const MISSION_STEP_TIMEOUT_MS = 3000
export const COMMAND_ACK_TIMEOUT_MS = 3000
/** ArduPilot doesn't ACK a legacy SET_MODE — confirmation is the vehicle's own next heartbeat reflecting the new mode, which can take a couple of heartbeat cycles, hence a longer timeout than the ACK-based commands above. */
export const MODE_CHANGE_TIMEOUT_MS = 5000
const POSITION_TOLERANCE_DEG = 1e-5 // ~1m at the equator — generous enough for int32 round-trip + firmware rounding

function fixTypeLabel(value: number): VehicleTelemetry['gps']['fixType'] {
  switch (value) {
    case 0:
      return 'no-gps'
    case 1:
      return 'no-fix'
    case 2:
      return '2d'
    case 3:
      return '3d'
    case 4:
      return 'dgps'
    case 5:
      return 'rtk-float'
    case 6:
      return 'rtk-fixed'
    case 8:
      return 'static'
    default:
      return 'unknown'
  }
}

interface FrameWaiter {
  predicate: (frame: DecodedFrame) => boolean
  resolve: (frame: DecodedFrame) => void
}

export class MavlinkSession {
  private frameReader = new MavlinkFrameReader()
  private seq = 0
  private telemetry: VehicleTelemetry = EMPTY_TELEMETRY
  private lastHeartbeatAt: number | null = null
  private vehicleSysId = 1
  private vehicleCompId = 1
  private frameWaiters: FrameWaiter[] = []

  private telemetryListeners = new Set<VehicleLinkEvents['onTelemetry']>()
  private logListeners = new Set<VehicleLinkEvents['onLog']>()

  private readonly write: (bytes: Uint8Array) => Promise<void>

  constructor(write: (bytes: Uint8Array) => Promise<void>) {
    this.write = write
  }

  getTelemetry(): VehicleTelemetry {
    return this.telemetry
  }
  getVehicleIdentity(): { sysid: number; compid: number } {
    return { sysid: this.vehicleSysId, compid: this.vehicleCompId }
  }

  onTelemetry(listener: VehicleLinkEvents['onTelemetry']): () => void {
    this.telemetryListeners.add(listener)
    return () => this.telemetryListeners.delete(listener)
  }
  onLog(listener: VehicleLinkEvents['onLog']): () => void {
    this.logListeners.add(listener)
    return () => this.logListeners.delete(listener)
  }
  private log(message: string) {
    for (const l of this.logListeners) l(message)
  }
  private emitTelemetry() {
    for (const l of this.telemetryListeners) l(this.telemetry)
  }

  /** Feed newly-arrived bytes from whatever transport owns this session. */
  feedBytes(bytes: Uint8Array): void {
    for (const frame of this.frameReader.push(bytes)) this.handleFrame(frame)
  }

  private handleFrame(frame: DecodedFrame) {
    if (frame.msgId === HEARTBEAT.id) {
      this.lastHeartbeatAt = Date.now()
      this.vehicleSysId = frame.sysid
      this.vehicleCompId = frame.compid
      const f = frame.fields
      const customModeEnabled = (f.baseMode & MAV_MODE_FLAG_CUSTOM_MODE_ENABLED) !== 0
      this.telemetry = {
        ...this.telemetry,
        heartbeatOk: true,
        heartbeatAgeMs: 0,
        systemStatus: MAV_STATE_LABELS[f.systemStatus] ?? `status ${f.systemStatus}`,
        flightMode: customModeEnabled ? (ARDUCOPTER_MODE_LABELS[f.customMode] ?? `Mode ${f.customMode}`) : null,
        armed: (f.baseMode & MAV_MODE_FLAG_SAFETY_ARMED) !== 0,
      }
      this.emitTelemetry()
    } else if (frame.msgId === SYS_STATUS.id) {
      const f = frame.fields
      this.telemetry = {
        ...this.telemetry,
        battery: {
          voltageV: f.voltageBattery === 65535 ? null : f.voltageBattery / 1000, // UINT16_MAX = "unknown", same convention GPS_RAW_INT.eph uses
          remainingPct: f.batteryRemaining === -1 ? null : f.batteryRemaining,
        },
      }
      this.emitTelemetry()
    } else if (frame.msgId === VFR_HUD.id) {
      const f = frame.fields
      this.telemetry = { ...this.telemetry, altitudeM: f.alt, headingDeg: f.heading }
      this.emitTelemetry()
    } else if (frame.msgId === WIND.id) {
      const f = frame.fields
      this.telemetry = { ...this.telemetry, wind: { speedMps: f.speed, directionDeg: f.direction } }
      this.emitTelemetry()
    } else if (frame.msgId === GPS_RAW_INT.id) {
      const f = frame.fields
      this.telemetry = {
        ...this.telemetry,
        gps: {
          fixType: fixTypeLabel(f.fixType),
          satellites: f.satellitesVisible,
          // eph is documented (MAVLink common.xml) as HDOP scaled x100; UINT16_MAX means "unknown".
          hdop: f.eph === 65535 ? null : f.eph / 100,
          position: f.fixType >= 2 ? { lat: f.lat / 1e7, lon: f.lon / 1e7 } : null,
        },
      }
      this.emitTelemetry()
    } else if (frame.msgId === ATTITUDE.id) {
      const f = frame.fields
      const toDeg = (rad: number) => (rad * 180) / Math.PI
      this.telemetry = {
        ...this.telemetry,
        attitude: { rollDeg: toDeg(f.roll), pitchDeg: toDeg(f.pitch), yawDeg: toDeg(f.yaw) },
      }
      this.emitTelemetry()
    } else if (frame.msgId === GLOBAL_POSITION_INT.id) {
      // Fused EKF position — not surfaced yet; GPS_RAW_INT drives the
      // primary position shown in the UI since it stays available on a
      // bench test even before the EKF fully settles.
      void frame
    } else if (frame.msgId === MISSION_ITEM_REACHED.id) {
      this.telemetry = { ...this.telemetry, lastReachedWaypointSeq: frame.fields.seq }
      this.emitTelemetry()
    }

    const idx = this.frameWaiters.findIndex((w) => w.predicate(frame))
    if (idx >= 0) {
      const [waiter] = this.frameWaiters.splice(idx, 1)
      waiter.resolve(frame)
    }
  }

  /** Call on a steady timer from the owning transport — refreshes heartbeat staleness and (re)sends our own GCS heartbeat. */
  async tick(): Promise<void> {
    try {
      await this.send(HEARTBEAT, {
        customMode: 0,
        type: MAV_TYPE_GCS,
        autopilot: MAV_AUTOPILOT_INVALID,
        baseMode: 0,
        systemStatus: MAV_STATE_ACTIVE,
        mavlinkVersion: 3,
      })
    } catch {
      /* transient write failure — the next tick retries */
    }
    if (this.lastHeartbeatAt !== null) {
      const age = Date.now() - this.lastHeartbeatAt
      const heartbeatOk = age < HEARTBEAT_STALE_MS
      if (heartbeatOk !== this.telemetry.heartbeatOk || age !== this.telemetry.heartbeatAgeMs) {
        this.telemetry = { ...this.telemetry, heartbeatOk, heartbeatAgeMs: age }
        this.emitTelemetry()
      }
    }
  }

  waitForHeartbeat(timeoutMs: number): Promise<DecodedFrame> {
    return this.waitForFrame((f) => f.msgId === HEARTBEAT.id, timeoutMs)
  }

  /** Arms (or disarms) via MAV_CMD_COMPONENT_ARM_DISARM, waiting for the vehicle's COMMAND_ACK before resolving. */
  async armDisarm(arm: boolean): Promise<void> {
    await this.send(COMMAND_LONG, {
      targetSystem: this.vehicleSysId,
      targetComponent: this.vehicleCompId,
      command: MAV_CMD_COMPONENT_ARM_DISARM,
      confirmation: 0,
      param1: arm ? 1 : 0,
      param2: 0,
      param3: 0,
      param4: 0,
      param5: 0,
      param6: 0,
      param7: 0,
    })
    const ack = await this.waitForFrame(
      (f) => f.msgId === COMMAND_ACK.id && f.fields.command === MAV_CMD_COMPONENT_ARM_DISARM,
      COMMAND_ACK_TIMEOUT_MS,
    )
    if (ack.fields.result !== MAV_RESULT_ACCEPTED) {
      throw new Error(
        `Vehicle rejected the ${arm ? 'arm' : 'disarm'} request (MAV_RESULT code ${ack.fields.result}) — most likely a failed pre-arm safety check (no GPS lock, bad calibration, etc). This app doesn't decode the vehicle's STATUSTEXT messages, so the specific reason isn't available here; check the flight controller's own logs or another GCS for details.`,
      )
    }
  }

  /**
   * Brake (alt-hold), Resume (auto — picks the mission back up from its
   * current waypoint), or Land. ArduPilot doesn't COMMAND_ACK the legacy
   * SET_MODE message, so the only real confirmation is the vehicle's own
   * next heartbeat reporting the new custom_mode.
   */
  async setFlightMode(mode: FlightModeCommand): Promise<void> {
    const customMode = FLIGHT_MODE_CUSTOM_NUMBER[mode]
    await this.send(SET_MODE, {
      targetSystem: this.vehicleSysId,
      baseMode: MAV_MODE_FLAG_CUSTOM_MODE_ENABLED,
      customMode,
    })
    await this.waitForFrame((f) => f.msgId === HEARTBEAT.id && f.fields.customMode === customMode, MODE_CHANGE_TIMEOUT_MS)
  }

  /** Rejects every pending waiter — call when the transport is torn down, so nothing hangs forever. */
  cancelAllWaits(reason: string): void {
    for (const waiter of this.frameWaiters.splice(0)) {
      void waiter // waiters reject themselves via their own timeout; this just drops references
      this.log(`Cancelled a pending wait: ${reason}`)
    }
  }

  private waitForFrame(predicate: (frame: DecodedFrame) => boolean, timeoutMs: number): Promise<DecodedFrame> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.frameWaiters = this.frameWaiters.filter((w) => w !== waiter)
        reject(new Error('Timed out waiting for a response from the vehicle.'))
      }, timeoutMs)
      const waiter: FrameWaiter = {
        predicate,
        resolve: (frame) => {
          clearTimeout(timer)
          resolve(frame)
        },
      }
      this.frameWaiters.push(waiter)
    })
  }

  private async send(def: Parameters<typeof encodeFrame>[0], values: Record<string, number>): Promise<void> {
    const frame = encodeFrame(def, values, { sysid: GCS_SYSID, compid: GCS_COMPID, seq: this.seq++ & 0xff })
    await this.write(frame)
  }

  /**
   * The standard MAVLink mission upload handshake: send MISSION_COUNT,
   * then answer each MISSION_REQUEST_INT (or legacy MISSION_REQUEST) the
   * vehicle sends back with the matching MISSION_ITEM_INT, until a
   * MISSION_ACK closes the transaction.
   */
  private async uploadMission(waypoints: MissionWaypoint[]): Promise<void> {
    await this.send(MISSION_COUNT, {
      count: waypoints.length,
      targetSystem: this.vehicleSysId,
      targetComponent: this.vehicleCompId,
    })

    let remaining = waypoints.length
    while (remaining > 0) {
      const request = await this.waitForFrame(
        (f) => f.msgId === MISSION_REQUEST_INT.id || f.msgId === MISSION_REQUEST.id,
        MISSION_STEP_TIMEOUT_MS,
      )
      const seq = request.fields.seq
      const wp = waypoints[seq]
      if (!wp) throw new Error(`Vehicle requested unknown mission item seq ${seq}.`)

      await this.send(MISSION_ITEM_INT, {
        seq: wp.seq,
        command: wp.command,
        targetSystem: this.vehicleSysId,
        targetComponent: this.vehicleCompId,
        frame: MAV_FRAME_GLOBAL_RELATIVE_ALT_INT,
        current: 0,
        autocontinue: 1,
        param1: 0,
        param2: 0,
        param3: 0,
        param4: 0,
        x: Math.round(wp.position.lat * 1e7),
        y: Math.round(wp.position.lon * 1e7),
        z: wp.altM,
      })
      remaining--
    }

    const ack = await this.waitForFrame((f) => f.msgId === MISSION_ACK.id, MISSION_STEP_TIMEOUT_MS)
    if (ack.fields.type !== MAV_MISSION_ACCEPTED) {
      throw new Error(`Vehicle rejected the mission (MAV_MISSION_RESULT ${ack.fields.type}).`)
    }
  }

  /** Downloads the mission currently on the vehicle — used to verify an upload actually took. */
  private async downloadMission(): Promise<MissionWaypoint[]> {
    await this.send(MISSION_REQUEST_LIST, { targetSystem: this.vehicleSysId, targetComponent: this.vehicleCompId })
    const countFrame = await this.waitForFrame((f) => f.msgId === MISSION_COUNT.id, MISSION_STEP_TIMEOUT_MS)
    const count = countFrame.fields.count

    const items: MissionWaypoint[] = []
    for (let seq = 0; seq < count; seq++) {
      await this.send(MISSION_REQUEST_INT, { seq, targetSystem: this.vehicleSysId, targetComponent: this.vehicleCompId })
      const itemFrame = await this.waitForFrame((f) => f.msgId === MISSION_ITEM_INT.id && f.fields.seq === seq, MISSION_STEP_TIMEOUT_MS)
      const f = itemFrame.fields
      items.push({ seq: f.seq, command: f.command, altM: f.z, position: { lat: f.x / 1e7, lon: f.y / 1e7 } })
    }

    await this.send(MISSION_ACK, { targetSystem: this.vehicleSysId, targetComponent: this.vehicleCompId, type: MAV_MISSION_ACCEPTED })
    return items
  }

  async uploadAndVerifyMission(waypoints: MissionWaypoint[]): Promise<MissionUploadResult> {
    await this.uploadMission(waypoints)
    const readBack = await this.downloadMission()

    const mismatches: MissionUploadResult['mismatches'] = []
    if (readBack.length !== waypoints.length) {
      mismatches.push({ seq: -1, reason: `Uploaded ${waypoints.length} waypoints but read back ${readBack.length}.` })
    }
    for (const wp of waypoints) {
      const match = readBack.find((r) => r.seq === wp.seq)
      if (!match) {
        mismatches.push({ seq: wp.seq, reason: 'Missing from read-back.' })
        continue
      }
      const latOff = Math.abs(match.position.lat - wp.position.lat)
      const lonOff = Math.abs(match.position.lon - wp.position.lon)
      if (latOff > POSITION_TOLERANCE_DEG || lonOff > POSITION_TOLERANCE_DEG) {
        mismatches.push({ seq: wp.seq, reason: `Position off by (${latOff.toExponential(2)}, ${lonOff.toExponential(2)}) deg.` })
      }
    }

    return {
      uploadedCount: waypoints.length,
      readBack,
      verified: mismatches.length === 0,
      mismatches,
    }
  }
}
