/**
 * Exercises MavlinkSession's mission-upload/download state machine
 * against a simulated vehicle (FakeVehicle below) that speaks the real
 * MAVLink mission protocol sequence — COUNT -> REQUEST_INT/ITEM_INT
 * per item -> ACK, and the mirrored download. This proves the
 * sequencing logic (what we send, what we wait for, in what order) is
 * correct in isolation. It does NOT prove a real Pixhawk behaves
 * exactly like FakeVehicle — ArduPilot's actual request/retry/timeout
 * behavior is real firmware behavior this test can't reach. See
 * VEHICLE_CONNECTION_CHECKLIST.md for what still needs real hardware.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { encodeFrame, MavlinkFrameReader, type DecodedFrame } from './mavlink/codec'
import {
  COMMAND_ACK,
  COMMAND_LONG,
  HEARTBEAT,
  MAV_CMD_COMPONENT_ARM_DISARM,
  MAV_FRAME_GLOBAL_RELATIVE_ALT_INT,
  MAV_MISSION_ACCEPTED,
  MAV_MODE_FLAG_CUSTOM_MODE_ENABLED,
  MAV_MODE_FLAG_SAFETY_ARMED,
  MAV_RESULT_ACCEPTED,
  MISSION_ACK,
  MISSION_COUNT,
  MISSION_ITEM_INT,
  MISSION_ITEM_REACHED,
  MISSION_REQUEST_INT,
  MISSION_REQUEST_LIST,
  SET_MODE,
  SYS_STATUS,
  VFR_HUD,
  WIND,
} from './mavlink/messages'
import type { LatLng } from '@/lib/geo/types'
import { GCS_COMPID, GCS_SYSID, MavlinkSession } from './mavlinkSession'
import type { MissionWaypoint } from './types'

const VEHICLE_SYSID = 1
const VEHICLE_COMPID = 1

/** A minimal fake ArduPilot-like vehicle: answers the standard mission upload/download handshake. */
class FakeVehicle {
  private reader = new MavlinkFrameReader()
  private mission: Array<{ seq: number; command: number; x: number; y: number; z: number }> = []
  private seqCounter = 0
  private armed = false
  private customMode = 0
  onOutgoing: (bytes: Uint8Array) => void = () => {}
  rejectUploads = false
  rejectArm = false
  /** Simulates ArduPilot's real behavior: mission item seq 0 is HOME, and the vehicle substitutes its own position for whatever was uploaded there — here, an unset-GPS-fix (0, 0). */
  overwriteHomeWithZero = false

  receive(bytes: Uint8Array) {
    for (const frame of this.reader.push(bytes)) this.handle(frame)
  }

  sendHeartbeat() {
    this.send(HEARTBEAT, { customMode: 0, type: 2, autopilot: 3, baseMode: 81, systemStatus: 4, mavlinkVersion: 3 })
  }

  private sendCurrentStateHeartbeat() {
    const baseMode = MAV_MODE_FLAG_CUSTOM_MODE_ENABLED | (this.armed ? MAV_MODE_FLAG_SAFETY_ARMED : 0)
    this.send(HEARTBEAT, { customMode: this.customMode, type: 2, autopilot: 3, baseMode, systemStatus: 4, mavlinkVersion: 3 })
  }

  private send(def: Parameters<typeof encodeFrame>[0], values: Record<string, number>) {
    const frame = encodeFrame(def, values, { sysid: VEHICLE_SYSID, compid: VEHICLE_COMPID, seq: this.seqCounter++ & 0xff })
    this.onOutgoing(frame)
  }

  private handle(frame: DecodedFrame) {
    if (frame.msgId === MISSION_COUNT.id) {
      this.mission = new Array(frame.fields.count)
      if (frame.fields.count > 0) {
        this.send(MISSION_REQUEST_INT, { seq: 0, targetSystem: GCS_SYSID, targetComponent: GCS_COMPID })
      } else {
        this.send(MISSION_ACK, { targetSystem: GCS_SYSID, targetComponent: GCS_COMPID, type: MAV_MISSION_ACCEPTED })
      }
    } else if (frame.msgId === MISSION_ITEM_INT.id) {
      const f = frame.fields
      const overwriteHome = this.overwriteHomeWithZero && f.seq === 0
      this.mission[f.seq] = { seq: f.seq, command: f.command, x: overwriteHome ? 0 : f.x, y: overwriteHome ? 0 : f.y, z: f.z }
      if (f.seq + 1 < this.mission.length) {
        this.send(MISSION_REQUEST_INT, { seq: f.seq + 1, targetSystem: GCS_SYSID, targetComponent: GCS_COMPID })
      } else if (this.rejectUploads) {
        this.send(MISSION_ACK, { targetSystem: GCS_SYSID, targetComponent: GCS_COMPID, type: 1 /* MAV_MISSION_ERROR */ })
      } else {
        this.send(MISSION_ACK, { targetSystem: GCS_SYSID, targetComponent: GCS_COMPID, type: MAV_MISSION_ACCEPTED })
      }
    } else if (frame.msgId === MISSION_REQUEST_LIST.id) {
      this.send(MISSION_COUNT, { count: this.mission.length, targetSystem: GCS_SYSID, targetComponent: GCS_COMPID })
    } else if (frame.msgId === MISSION_REQUEST_INT.id) {
      const item = this.mission[frame.fields.seq]
      this.send(MISSION_ITEM_INT, {
        seq: item.seq,
        command: item.command,
        x: item.x,
        y: item.y,
        z: item.z,
        targetSystem: GCS_SYSID,
        targetComponent: GCS_COMPID,
        frame: MAV_FRAME_GLOBAL_RELATIVE_ALT_INT,
        current: 0,
        autocontinue: 1,
        param1: 0,
        param2: 0,
        param3: 0,
        param4: 0,
      })
    } else if (frame.msgId === COMMAND_LONG.id && frame.fields.command === MAV_CMD_COMPONENT_ARM_DISARM) {
      if (!this.rejectArm) this.armed = frame.fields.param1 === 1
      this.send(COMMAND_ACK, {
        command: MAV_CMD_COMPONENT_ARM_DISARM,
        result: this.rejectArm ? 4 /* MAV_RESULT_FAILED */ : MAV_RESULT_ACCEPTED,
      })
    } else if (frame.msgId === SET_MODE.id) {
      this.customMode = frame.fields.customMode
      this.sendCurrentStateHeartbeat()
    }
    // MISSION_ACK from the GCS (closing a download) needs no response.
  }
}

function setUp() {
  const vehicle = new FakeVehicle()
  const session = new MavlinkSession(async (bytes) => vehicle.receive(bytes))
  // Deliver the vehicle's reply on a later tick, not synchronously
  // within the same call stack as the outgoing write — a real serial
  // round-trip can never be faster than that, and delivering it
  // synchronously would let the reply arrive before uploadMission()
  // has even registered its waitForFrame() listener for it.
  vehicle.onOutgoing = (bytes) => {
    setTimeout(() => session.feedBytes(bytes), 0)
  }
  return { vehicle, session }
}

const SAMPLE_WAYPOINTS: MissionWaypoint[] = [
  { seq: 0, command: 16, altM: 3, position: { lat: 12.3456, lon: 76.5432 } },
  { seq: 1, command: 16, altM: 3, position: { lat: 12.3457, lon: 76.5433 } },
  { seq: 2, command: 16, altM: 3, position: { lat: 12.3458, lon: 76.5434 } },
]
const SAMPLE_HOME: LatLng = { lat: 12.34, lon: 76.54 }

describe('MavlinkSession + FakeVehicle', () => {
  it('resolves waitForHeartbeat once the vehicle sends one', async () => {
    const { vehicle, session } = setUp()
    const promise = session.waitForHeartbeat(1000)
    vehicle.sendHeartbeat()
    const frame = await promise
    expect(frame.msgId).toBe(HEARTBEAT.id)
  })

  it('captures the vehicle sysid/compid from its heartbeat', async () => {
    const { vehicle, session } = setUp()
    const promise = session.waitForHeartbeat(1000)
    vehicle.sendHeartbeat()
    await promise
    expect(session.getVehicleIdentity()).toEqual({ sysid: VEHICLE_SYSID, compid: VEHICLE_COMPID })
  })

  it('uploads a mission (with a synthetic home item at wire seq 0), reads it back, and verifies every real waypoint matches', async () => {
    const { session } = setUp()
    const result = await session.uploadAndVerifyMission(SAMPLE_WAYPOINTS, SAMPLE_HOME)

    expect(result.uploadedCount).toBe(3)
    expect(result.verified).toBe(true)
    expect(result.mismatches).toEqual([])
    // 3 real waypoints + the synthetic home item at wire seq 0.
    expect(result.readBack).toHaveLength(4)
    for (const wp of SAMPLE_WAYPOINTS) {
      const match = result.readBack.find((r) => r.seq === wp.seq + 1)!
      expect(match.position.lat).toBeCloseTo(wp.position.lat, 6)
      expect(match.position.lon).toBeCloseTo(wp.position.lon, 6)
      expect(match.altM).toBe(wp.altM)
      expect(match.command).toBe(wp.command)
    }
  })

  it('does not flag a mismatch when the vehicle substitutes its own home position for wire seq 0 — the real regression this project hit against a real Pixhawk', async () => {
    const { vehicle, session } = setUp()
    vehicle.overwriteHomeWithZero = true
    const result = await session.uploadAndVerifyMission(SAMPLE_WAYPOINTS, SAMPLE_HOME)

    expect(result.verified).toBe(true)
    expect(result.mismatches).toEqual([])
    const homeReadBack = result.readBack.find((r) => r.seq === 0)!
    expect(homeReadBack.position).toEqual({ lat: 0, lon: 0 }) // the vehicle's substituted value, not SAMPLE_HOME — and correctly ignored
  })

  it('surfaces a vehicle-side mission rejection as a thrown error', async () => {
    const { vehicle, session } = setUp()
    vehicle.rejectUploads = true
    await expect(session.uploadAndVerifyMission(SAMPLE_WAYPOINTS, SAMPLE_HOME)).rejects.toThrow(/rejected the mission/i)
  })

  it('handles an empty mission (zero waypoints) without hanging or sending anything, including no home item', async () => {
    const { session } = setUp()
    const result = await session.uploadAndVerifyMission([], SAMPLE_HOME)
    expect(result.uploadedCount).toBe(0)
    expect(result.readBack).toEqual([])
    expect(result.verified).toBe(true)
  })
})

describe('MavlinkSession.armDisarm', () => {
  it('resolves once the vehicle COMMAND_ACKs the arm request', async () => {
    const { session } = setUp()
    await expect(session.armDisarm(true)).resolves.toBeUndefined()
  })

  it('resolves for a disarm request the same way', async () => {
    const { session } = setUp()
    await session.armDisarm(true)
    await expect(session.armDisarm(false)).resolves.toBeUndefined()
  })

  it('rejects with the MAV_RESULT code when the vehicle refuses to arm (e.g. a failed pre-arm check)', async () => {
    const { vehicle, session } = setUp()
    vehicle.rejectArm = true
    await expect(session.armDisarm(true)).rejects.toThrow(/rejected the arm request.*MAV_RESULT code 4/i)
  })
})

describe('MavlinkSession.setFlightMode', () => {
  it('resolves once the vehicle heartbeat reflects the new custom_mode (alt-hold)', async () => {
    const { session } = setUp()
    await session.setFlightMode('alt-hold')
    expect(session.getTelemetry().flightMode).toBe('Alt Hold')
  })

  it('resolves for auto (Resume) the same way', async () => {
    const { session } = setUp()
    await session.setFlightMode('auto')
    expect(session.getTelemetry().flightMode).toBe('Auto')
  })

  it('times out if the vehicle never reflects the requested mode', async () => {
    vi.useFakeTimers()
    const session = new MavlinkSession(async () => {}) // a "vehicle" that never responds
    const promise = session.setFlightMode('land')
    const assertion = expect(promise).rejects.toThrow(/timed out/i)
    await vi.advanceTimersByTimeAsync(5001)
    await assertion
    vi.useRealTimers()
  })
})

describe('MavlinkSession telemetry decoding', () => {
  function sendFromVehicle(session: MavlinkSession, def: Parameters<typeof encodeFrame>[0], values: Record<string, number>) {
    const frame = encodeFrame(def, values, { sysid: VEHICLE_SYSID, compid: VEHICLE_COMPID, seq: 0 })
    session.feedBytes(frame)
  }

  it('decodes HEARTBEAT into systemStatus and flightMode (ArduCopter custom_mode)', () => {
    const { session } = setUp()
    // baseMode 217 = 0b11011001 has bit 0 (CUSTOM_MODE_ENABLED) set; custom_mode 5 = Loiter.
    sendFromVehicle(session, HEARTBEAT, { customMode: 5, type: 2, autopilot: 3, baseMode: 217, systemStatus: 4, mavlinkVersion: 3 })
    const telemetry = session.getTelemetry()
    expect(telemetry.systemStatus).toBe('active')
    expect(telemetry.flightMode).toBe('Loiter')
  })

  it('falls back to a numbered mode label for an unrecognized custom_mode', () => {
    const { session } = setUp()
    sendFromVehicle(session, HEARTBEAT, { customMode: 99, type: 2, autopilot: 3, baseMode: 217, systemStatus: 3, mavlinkVersion: 3 })
    expect(session.getTelemetry().flightMode).toBe('Mode 99')
    expect(session.getTelemetry().systemStatus).toBe('standby')
  })

  it('leaves flightMode null when the custom-mode-enabled bit is not set', () => {
    const { session } = setUp()
    sendFromVehicle(session, HEARTBEAT, { customMode: 5, type: 2, autopilot: 3, baseMode: 0, systemStatus: 4, mavlinkVersion: 3 })
    expect(session.getTelemetry().flightMode).toBeNull()
  })

  it('decodes the armed flag from HEARTBEAT.base_mode', () => {
    const { session } = setUp()
    // 217 = 0b11011001 has bit 7 (MAV_MODE_FLAG_SAFETY_ARMED) set.
    sendFromVehicle(session, HEARTBEAT, { customMode: 0, type: 2, autopilot: 3, baseMode: 217, systemStatus: 4, mavlinkVersion: 3 })
    expect(session.getTelemetry().armed).toBe(true)
    // 89 = 0b01011001 does not.
    sendFromVehicle(session, HEARTBEAT, { customMode: 0, type: 2, autopilot: 3, baseMode: 89, systemStatus: 4, mavlinkVersion: 3 })
    expect(session.getTelemetry().armed).toBe(false)
  })

  it('decodes MISSION_ITEM_REACHED into lastReachedWaypointSeq — live mission progress toward the finish point', () => {
    const { session } = setUp()
    expect(session.getTelemetry().lastReachedWaypointSeq).toBeNull()
    sendFromVehicle(session, MISSION_ITEM_REACHED, { seq: 0 })
    expect(session.getTelemetry().lastReachedWaypointSeq).toBe(0)
    sendFromVehicle(session, MISSION_ITEM_REACHED, { seq: 5 })
    expect(session.getTelemetry().lastReachedWaypointSeq).toBe(5)
  })

  it('decodes SYS_STATUS battery voltage/remaining, normalizing the -1 "unknown" sentinel to null', () => {
    const { session } = setUp()
    sendFromVehicle(session, SYS_STATUS, {
      onboardControlSensorsPresent: 0,
      onboardControlSensorsEnabled: 0,
      onboardControlSensorsHealth: 0,
      load: 0,
      voltageBattery: 12345, // 12.345V
      currentBattery: -1,
      dropRateComm: 0,
      errorsComm: 0,
      errorsCount1: 0,
      errorsCount2: 0,
      errorsCount3: 0,
      errorsCount4: 0,
      batteryRemaining: -1,
    })
    const battery = session.getTelemetry().battery
    expect(battery?.voltageV).toBeCloseTo(12.345, 5)
    expect(battery?.remainingPct).toBeNull()
  })

  it('decodes VFR_HUD into altitudeM and headingDeg', () => {
    const { session } = setUp()
    sendFromVehicle(session, VFR_HUD, { airspeed: 0, groundspeed: 3.2, alt: 42.5, climb: 0, heading: 180, throttle: 30 })
    const telemetry = session.getTelemetry()
    expect(telemetry.altitudeM).toBeCloseTo(42.5, 4)
    expect(telemetry.headingDeg).toBe(180)
  })

  it('decodes WIND when the vehicle sends it — stays null otherwise, never invented', () => {
    const { session } = setUp()
    expect(session.getTelemetry().wind).toBeNull()
    sendFromVehicle(session, WIND, { direction: 90, speed: 2.1, speedZ: 0 })
    const wind = session.getTelemetry().wind
    expect(wind?.directionDeg).toBeCloseTo(90, 4)
    expect(wind?.speedMps).toBeCloseTo(2.1, 4)
  })
})

describe('MavlinkSession timeouts', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('rejects waitForHeartbeat if none arrives in time', async () => {
    const session = new MavlinkSession(async () => {})
    const promise = session.waitForHeartbeat(1000)
    const assertion = expect(promise).rejects.toThrow(/timed out/i)
    await vi.advanceTimersByTimeAsync(1001)
    await assertion
  })

  it('rejects uploadAndVerifyMission if the vehicle never answers MISSION_COUNT', async () => {
    const session = new MavlinkSession(async () => {}) // a "vehicle" that never responds to anything
    const promise = session.uploadAndVerifyMission(SAMPLE_WAYPOINTS, SAMPLE_HOME)
    const assertion = expect(promise).rejects.toThrow(/timed out/i)
    await vi.advanceTimersByTimeAsync(3001)
    await assertion
  })
})
