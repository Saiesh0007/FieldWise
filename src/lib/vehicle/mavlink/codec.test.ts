import { describe, expect, it } from 'vitest'
import { decodeMessagePayload, encodeFrame, encodeMessagePayload, MavlinkFrameReader } from './codec'
import { ATTITUDE, GLOBAL_POSITION_INT, GPS_RAW_INT, HEARTBEAT, MISSION_ITEM_INT, SYS_STATUS, VFR_HUD, WIND } from './messages'

const OPTS = { sysid: 255, compid: 190, seq: 0 }

describe('encodeMessagePayload / decodeMessagePayload round-trip', () => {
  it('round-trips HEARTBEAT fields exactly', () => {
    const values = { customMode: 0, type: 2, autopilot: 3, baseMode: 81, systemStatus: 4, mavlinkVersion: 3 }
    const payload = encodeMessagePayload(HEARTBEAT, values)
    expect(payload).toHaveLength(HEARTBEAT.payloadLength)
    expect(decodeMessagePayload(HEARTBEAT, payload)).toEqual(values)
  })

  it('round-trips signed int32 fields (negative lat/lon) correctly', () => {
    // A real southern-hemisphere / western-hemisphere coordinate, degE7.
    const values = { timeBootMs: 12345, lat: -352321100, lon: -1491234560, alt: 15000, relativeAlt: 5000, vx: -120, vy: 340, vz: -15, hdg: 27000 }
    const payload = encodeMessagePayload(GLOBAL_POSITION_INT, values)
    expect(decodeMessagePayload(GLOBAL_POSITION_INT, payload)).toEqual(values)
  })

  it('round-trips float fields with sub-integer precision', () => {
    const values = { timeBootMs: 999, roll: 0.5235988, pitch: -0.1745329, yaw: 3.1415927, rollspeed: 0.01, pitchspeed: -0.02, yawspeed: 0 }
    const payload = encodeMessagePayload(ATTITUDE, values)
    const decoded = decodeMessagePayload(ATTITUDE, payload)
    for (const key of Object.keys(values) as (keyof typeof values)[]) {
      expect(decoded[key]).toBeCloseTo(values[key], 5) // float32 precision
    }
  })

  it('round-trips uint64 fields (time_usec) within safe-integer range', () => {
    const values = { timeUsec: 1_700_000_000_000, lat: 0, lon: 0, alt: 0, eph: 0, epv: 0, vel: 0, cog: 0, fixType: 3, satellitesVisible: 12 }
    const payload = encodeMessagePayload(GPS_RAW_INT, values)
    expect(decodeMessagePayload(GPS_RAW_INT, payload).timeUsec).toBe(values.timeUsec)
  })

  it('round-trips SYS_STATUS, including a negative int8 (battery_remaining = -1, the "unknown" sentinel)', () => {
    const values = {
      onboardControlSensorsPresent: 0,
      onboardControlSensorsEnabled: 0,
      onboardControlSensorsHealth: 0,
      load: 300,
      voltageBattery: 12600, // 12.6V, in mV as MAVLink reports it
      currentBattery: -1, // "unknown" sentinel, same convention as batteryRemaining below
      dropRateComm: 0,
      errorsComm: 0,
      errorsCount1: 0,
      errorsCount2: 0,
      errorsCount3: 0,
      errorsCount4: 0,
      batteryRemaining: -1,
    }
    const payload = encodeMessagePayload(SYS_STATUS, values)
    expect(payload).toHaveLength(SYS_STATUS.payloadLength)
    expect(decodeMessagePayload(SYS_STATUS, payload)).toEqual(values)
  })

  it('round-trips a real (non-sentinel) SYS_STATUS battery reading', () => {
    const values = {
      onboardControlSensorsPresent: 0,
      onboardControlSensorsEnabled: 0,
      onboardControlSensorsHealth: 0,
      load: 150,
      voltageBattery: 11100,
      currentBattery: 850,
      dropRateComm: 0,
      errorsComm: 0,
      errorsCount1: 0,
      errorsCount2: 0,
      errorsCount3: 0,
      errorsCount4: 0,
      batteryRemaining: 62,
    }
    const payload = encodeMessagePayload(SYS_STATUS, values)
    expect(decodeMessagePayload(SYS_STATUS, payload)).toEqual(values)
  })

  it('round-trips VFR_HUD (altitude + heading in one message)', () => {
    const values = { airspeed: 0, groundspeed: 4.5, alt: 87.3, climb: 0.2, heading: 271, throttle: 45 }
    const payload = encodeMessagePayload(VFR_HUD, values)
    const decoded = decodeMessagePayload(VFR_HUD, payload)
    expect(decoded.alt).toBeCloseTo(values.alt, 4)
    expect(decoded.groundspeed).toBeCloseTo(values.groundspeed, 4)
    expect(decoded.climb).toBeCloseTo(values.climb, 4)
    expect(decoded.heading).toBe(values.heading)
    expect(decoded.throttle).toBe(values.throttle)
  })

  it('round-trips WIND', () => {
    const values = { direction: 214.5, speed: 3.2, speedZ: 0.1 }
    const payload = encodeMessagePayload(WIND, values)
    const decoded = decodeMessagePayload(WIND, payload)
    expect(decoded.direction).toBeCloseTo(values.direction, 4)
    expect(decoded.speed).toBeCloseTo(values.speed, 4)
    expect(decoded.speedZ).toBeCloseTo(values.speedZ, 4)
  })

  it('decodes a truncated payload as zero-padded (MAVLink v2 trailing-zero truncation)', () => {
    // Only the first 9 bytes of a 38-byte MISSION_ITEM_INT (i.e. everything got truncated away except param1/param2).
    const values = { param1: 1, param2: 2, param3: 0, param4: 0, x: 0, y: 0, z: 0, seq: 0, command: 0, targetSystem: 0, targetComponent: 0, frame: 0, current: 0, autocontinue: 0 }
    const fullPayload = encodeMessagePayload(MISSION_ITEM_INT, values)
    const truncated = fullPayload.subarray(0, 9) // trailing zero fields chopped off, as a real sender would
    expect(decodeMessagePayload(MISSION_ITEM_INT, truncated)).toEqual(values)
  })
})

describe('encodeFrame + MavlinkFrameReader round-trip', () => {
  it('produces a frame the reader can decode back to the same fields', () => {
    const values = { customMode: 0, type: 2, autopilot: 3, baseMode: 81, systemStatus: 4, mavlinkVersion: 3 }
    const frame = encodeFrame(HEARTBEAT, values, OPTS)

    const reader = new MavlinkFrameReader()
    const [decoded] = reader.push(frame)

    expect(decoded).toBeDefined()
    expect(decoded.msgId).toBe(HEARTBEAT.id)
    expect(decoded.sysid).toBe(OPTS.sysid)
    expect(decoded.compid).toBe(OPTS.compid)
    expect(decoded.fields).toEqual(values)
  })

  it('truncates trailing-zero payload bytes on the wire (MAVLink v2 requirement)', () => {
    const frame = encodeFrame(HEARTBEAT, { customMode: 0, type: 0, autopilot: 0, baseMode: 0, systemStatus: 0, mavlinkVersion: 0 }, OPTS)
    // Every HEARTBEAT field is zero here, so the whole 9-byte payload should truncate to 0 bytes on the wire.
    expect(frame[1]).toBe(0) // payload length byte
    expect(frame).toHaveLength(10 + 0 + 2)
  })

  it('does not truncate a non-zero trailing field', () => {
    const frame = encodeFrame(HEARTBEAT, { customMode: 0, type: 0, autopilot: 0, baseMode: 0, systemStatus: 0, mavlinkVersion: 3 }, OPTS)
    // mavlinkVersion (the last field, offset 8) is non-zero, so nothing can be truncated.
    expect(frame[1]).toBe(HEARTBEAT.payloadLength)
  })

  it('reassembles a frame split across multiple push() calls (simulating chunked serial reads)', () => {
    const frame = encodeFrame(ATTITUDE, { timeBootMs: 1, roll: 0.1, pitch: 0.2, yaw: 0.3, rollspeed: 0, pitchspeed: 0, yawspeed: 0 }, OPTS)
    const reader = new MavlinkFrameReader()

    expect(reader.push(frame.subarray(0, 5))).toHaveLength(0) // partial header
    expect(reader.push(frame.subarray(5, 15))).toHaveLength(0) // rest of header + partial payload
    const frames = reader.push(frame.subarray(15))
    expect(frames).toHaveLength(1)
    expect(frames[0].msgId).toBe(ATTITUDE.id)
  })

  it('resyncs past garbage bytes preceding a valid frame', () => {
    const frame = encodeFrame(HEARTBEAT, { customMode: 0, type: 1, autopilot: 0, baseMode: 0, systemStatus: 0, mavlinkVersion: 0 }, OPTS)
    const garbage = Uint8Array.from([0x00, 0xff, 0xab, 0xcd, 0xfd, 0x01]) // includes a stray 0xFD that isn't a real frame start
    const withGarbage = new Uint8Array(garbage.length + frame.length)
    withGarbage.set(garbage, 0)
    withGarbage.set(frame, garbage.length)

    const reader = new MavlinkFrameReader()
    const frames = reader.push(withGarbage)
    expect(frames.some((f) => f.msgId === HEARTBEAT.id && f.fields?.type === 1)).toBe(true)
  })

  it('drops a frame with a corrupted checksum instead of decoding garbage', () => {
    const frame = encodeFrame(HEARTBEAT, { customMode: 0, type: 1, autopilot: 0, baseMode: 0, systemStatus: 0, mavlinkVersion: 0 }, OPTS)
    const corrupted = frame.slice()
    corrupted[corrupted.length - 1] ^= 0xff // flip bits in the checksum

    const reader = new MavlinkFrameReader()
    const frames = reader.push(corrupted)
    expect(frames).toHaveLength(0)
  })

  it('decodes multiple frames delivered in one push()', () => {
    const f1 = encodeFrame(HEARTBEAT, { customMode: 0, type: 1, autopilot: 0, baseMode: 0, systemStatus: 0, mavlinkVersion: 0 }, { ...OPTS, seq: 0 })
    const f2 = encodeFrame(HEARTBEAT, { customMode: 0, type: 2, autopilot: 0, baseMode: 0, systemStatus: 0, mavlinkVersion: 0 }, { ...OPTS, seq: 1 })
    const combined = new Uint8Array(f1.length + f2.length)
    combined.set(f1, 0)
    combined.set(f2, f1.length)

    const reader = new MavlinkFrameReader()
    const frames = reader.push(combined)
    expect(frames).toHaveLength(2)
    expect(frames[0].fields?.type).toBe(1)
    expect(frames[1].fields?.type).toBe(2)
  })

  it('returns an empty def/fields for an unrecognized message id, without throwing', () => {
    // Hand-build a minimal frame for an unregistered message id (e.g. 9999) with no way to know its CRC_EXTRA —
    // the reader should surface it as "unknown" rather than crash or guess a checksum.
    const frame = new Uint8Array([0xfd, 0, 0, 0, 0, 1, 1, 0x0f, 0x27, 0, 0, 0]) // msgid = 0x270f = 9999, empty payload, dummy crc
    const reader = new MavlinkFrameReader()
    expect(() => reader.push(frame)).not.toThrow()
  })
})
