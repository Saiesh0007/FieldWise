/**
 * The small subset of MAVLink v2 `common`/`minimal` dialect messages
 * this project needs. Every MSG_ID / PAYLOAD_LENGTH / CRC_EXTRA / field
 * offset below was read directly from the official generated message
 * definitions (the `mavlink-mappings` npm package's compiled dialect
 * files, which are code-generated from MAVLink's own XML — the same
 * source QGroundControl, Mission Planner, and pymavlink are generated
 * from) during development, not recalled from memory. See the project
 * notes for exactly which file/line each came from if these ever need
 * re-checking against a newer MAVLink release.
 *
 * Field lists below cover only the non-extension fields this app reads
 * or writes. MAVLink v2 requires senders to truncate trailing
 * zero-valued bytes from a payload, and requires receivers to treat any
 * bytes missing from a short payload as zero — codec.ts implements both
 * sides of that rule, which is what makes omitting a message's
 * extension fields here safe rather than a silent bug: we simply never
 * populate them (they encode as zero, and typically get truncated away),
 * and we never expect the peer to have sent them.
 */
import type { FieldType } from './codec'

export interface FieldDef {
  /** camelCase — matches the decoded object's property name. */
  name: string
  offset: number
  type: FieldType
}

export interface MessageDef {
  id: number
  name: string
  /** Full (non-truncated) payload length, including extension fields we don't model. */
  payloadLength: number
  /** The message's CRC_EXTRA constant (called MAGIC_NUMBER in mavlink-mappings). */
  crcExtra: number
  fields: FieldDef[]
}

export const HEARTBEAT: MessageDef = {
  id: 0,
  name: 'HEARTBEAT',
  payloadLength: 9,
  crcExtra: 50,
  fields: [
    { name: 'customMode', offset: 0, type: 'uint32' },
    { name: 'type', offset: 4, type: 'uint8' },
    { name: 'autopilot', offset: 5, type: 'uint8' },
    { name: 'baseMode', offset: 6, type: 'uint8' },
    { name: 'systemStatus', offset: 7, type: 'uint8' },
    { name: 'mavlinkVersion', offset: 8, type: 'uint8' },
  ],
}

export const SYS_STATUS: MessageDef = {
  id: 1,
  name: 'SYS_STATUS',
  payloadLength: 43,
  crcExtra: 124,
  fields: [
    { name: 'onboardControlSensorsPresent', offset: 0, type: 'uint32' },
    { name: 'onboardControlSensorsEnabled', offset: 4, type: 'uint32' },
    { name: 'onboardControlSensorsHealth', offset: 8, type: 'uint32' },
    { name: 'load', offset: 12, type: 'uint16' },
    { name: 'voltageBattery', offset: 14, type: 'uint16' },
    { name: 'currentBattery', offset: 16, type: 'int16' },
    { name: 'dropRateComm', offset: 18, type: 'uint16' },
    { name: 'errorsComm', offset: 20, type: 'uint16' },
    { name: 'errorsCount1', offset: 22, type: 'uint16' },
    { name: 'errorsCount2', offset: 24, type: 'uint16' },
    { name: 'errorsCount3', offset: 26, type: 'uint16' },
    { name: 'errorsCount4', offset: 28, type: 'uint16' },
    { name: 'batteryRemaining', offset: 30, type: 'int8' },
  ],
}

export const GPS_RAW_INT: MessageDef = {
  id: 24,
  name: 'GPS_RAW_INT',
  payloadLength: 52,
  crcExtra: 24,
  fields: [
    { name: 'timeUsec', offset: 0, type: 'uint64' },
    { name: 'lat', offset: 8, type: 'int32' },
    { name: 'lon', offset: 12, type: 'int32' },
    { name: 'alt', offset: 16, type: 'int32' },
    { name: 'eph', offset: 20, type: 'uint16' },
    { name: 'epv', offset: 22, type: 'uint16' },
    { name: 'vel', offset: 24, type: 'uint16' },
    { name: 'cog', offset: 26, type: 'uint16' },
    { name: 'fixType', offset: 28, type: 'uint8' },
    { name: 'satellitesVisible', offset: 29, type: 'uint8' },
  ],
}

export const ATTITUDE: MessageDef = {
  id: 30,
  name: 'ATTITUDE',
  payloadLength: 28,
  crcExtra: 39,
  fields: [
    { name: 'timeBootMs', offset: 0, type: 'uint32' },
    { name: 'roll', offset: 4, type: 'float' },
    { name: 'pitch', offset: 8, type: 'float' },
    { name: 'yaw', offset: 12, type: 'float' },
    { name: 'rollspeed', offset: 16, type: 'float' },
    { name: 'pitchspeed', offset: 20, type: 'float' },
    { name: 'yawspeed', offset: 24, type: 'float' },
  ],
}

export const VFR_HUD: MessageDef = {
  id: 74,
  name: 'VFR_HUD',
  payloadLength: 20,
  crcExtra: 20,
  fields: [
    { name: 'airspeed', offset: 0, type: 'float' },
    { name: 'groundspeed', offset: 4, type: 'float' },
    { name: 'alt', offset: 8, type: 'float' },
    { name: 'climb', offset: 12, type: 'float' },
    { name: 'heading', offset: 16, type: 'int16' },
    { name: 'throttle', offset: 18, type: 'uint16' },
  ],
}

/**
 * ArduPilot-legacy wind estimate — not part of the shared `common`
 * dialect (it's in `ardupilotmega`), and not every ArduCopter
 * configuration emits it. Modeled the same way GPS/HDOP already are:
 * read if present, rendered as "—" if this message never arrives,
 * never assumed.
 */
export const WIND: MessageDef = {
  id: 168,
  name: 'WIND',
  payloadLength: 12,
  crcExtra: 1,
  fields: [
    { name: 'direction', offset: 0, type: 'float' },
    { name: 'speed', offset: 4, type: 'float' },
    { name: 'speedZ', offset: 8, type: 'float' },
  ],
}

export const GLOBAL_POSITION_INT: MessageDef = {
  id: 33,
  name: 'GLOBAL_POSITION_INT',
  payloadLength: 28,
  crcExtra: 104,
  fields: [
    { name: 'timeBootMs', offset: 0, type: 'uint32' },
    { name: 'lat', offset: 4, type: 'int32' },
    { name: 'lon', offset: 8, type: 'int32' },
    { name: 'alt', offset: 12, type: 'int32' },
    { name: 'relativeAlt', offset: 16, type: 'int32' },
    { name: 'vx', offset: 20, type: 'int16' },
    { name: 'vy', offset: 22, type: 'int16' },
    { name: 'vz', offset: 24, type: 'int16' },
    { name: 'hdg', offset: 26, type: 'uint16' },
  ],
}

export const MISSION_REQUEST: MessageDef = {
  id: 40, // legacy (pre-MISSION_REQUEST_INT); some older firmware still uses this
  name: 'MISSION_REQUEST',
  payloadLength: 5,
  crcExtra: 230,
  fields: [
    { name: 'seq', offset: 0, type: 'uint16' },
    { name: 'targetSystem', offset: 2, type: 'uint8' },
    { name: 'targetComponent', offset: 3, type: 'uint8' },
  ],
}

export const MISSION_REQUEST_LIST: MessageDef = {
  id: 43,
  name: 'MISSION_REQUEST_LIST',
  payloadLength: 3,
  crcExtra: 132,
  fields: [
    { name: 'targetSystem', offset: 0, type: 'uint8' },
    { name: 'targetComponent', offset: 1, type: 'uint8' },
  ],
}

export const MISSION_COUNT: MessageDef = {
  id: 44,
  name: 'MISSION_COUNT',
  payloadLength: 9,
  crcExtra: 221,
  fields: [
    { name: 'count', offset: 0, type: 'uint16' },
    { name: 'targetSystem', offset: 2, type: 'uint8' },
    { name: 'targetComponent', offset: 3, type: 'uint8' },
  ],
}

export const MISSION_ITEM_REACHED: MessageDef = {
  id: 46,
  name: 'MISSION_ITEM_REACHED',
  payloadLength: 2,
  crcExtra: 11,
  fields: [{ name: 'seq', offset: 0, type: 'uint16' }],
}

export const MISSION_ACK: MessageDef = {
  id: 47,
  name: 'MISSION_ACK',
  payloadLength: 8,
  crcExtra: 153,
  fields: [
    { name: 'targetSystem', offset: 0, type: 'uint8' },
    { name: 'targetComponent', offset: 1, type: 'uint8' },
    { name: 'type', offset: 2, type: 'uint8' },
  ],
}

export const MISSION_REQUEST_INT: MessageDef = {
  id: 51,
  name: 'MISSION_REQUEST_INT',
  payloadLength: 5,
  crcExtra: 196,
  fields: [
    { name: 'seq', offset: 0, type: 'uint16' },
    { name: 'targetSystem', offset: 2, type: 'uint8' },
    { name: 'targetComponent', offset: 3, type: 'uint8' },
  ],
}

export const MISSION_ITEM_INT: MessageDef = {
  id: 73,
  name: 'MISSION_ITEM_INT',
  payloadLength: 38,
  crcExtra: 38,
  fields: [
    { name: 'param1', offset: 0, type: 'float' },
    { name: 'param2', offset: 4, type: 'float' },
    { name: 'param3', offset: 8, type: 'float' },
    { name: 'param4', offset: 12, type: 'float' },
    { name: 'x', offset: 16, type: 'int32' },
    { name: 'y', offset: 20, type: 'int32' },
    { name: 'z', offset: 24, type: 'float' },
    { name: 'seq', offset: 28, type: 'uint16' },
    { name: 'command', offset: 30, type: 'uint16' },
    { name: 'targetSystem', offset: 32, type: 'uint8' },
    { name: 'targetComponent', offset: 33, type: 'uint8' },
    { name: 'frame', offset: 34, type: 'uint8' },
    { name: 'current', offset: 35, type: 'uint8' },
    { name: 'autocontinue', offset: 36, type: 'uint8' },
  ],
}

/** Legacy mode-change message — still what ArduPilot expects for a GCS-initiated flight-mode change (Route Adjust's Brake/Resume/Land buttons). */
export const SET_MODE: MessageDef = {
  id: 11,
  name: 'SET_MODE',
  payloadLength: 6,
  crcExtra: 89,
  fields: [
    { name: 'customMode', offset: 0, type: 'uint32' },
    { name: 'targetSystem', offset: 4, type: 'uint8' },
    { name: 'baseMode', offset: 5, type: 'uint8' },
  ],
}

/** The generic "do a thing" command message — this project only ever sends MAV_CMD_COMPONENT_ARM_DISARM through it. */
export const COMMAND_LONG: MessageDef = {
  id: 76,
  name: 'COMMAND_LONG',
  payloadLength: 33,
  crcExtra: 152,
  fields: [
    { name: 'param1', offset: 0, type: 'float' },
    { name: 'param2', offset: 4, type: 'float' },
    { name: 'param3', offset: 8, type: 'float' },
    { name: 'param4', offset: 12, type: 'float' },
    { name: 'param5', offset: 16, type: 'float' },
    { name: 'param6', offset: 20, type: 'float' },
    { name: 'param7', offset: 24, type: 'float' },
    { name: 'command', offset: 28, type: 'uint16' },
    { name: 'targetSystem', offset: 30, type: 'uint8' },
    { name: 'targetComponent', offset: 31, type: 'uint8' },
    { name: 'confirmation', offset: 32, type: 'uint8' },
  ],
}

/** The vehicle's response to a COMMAND_LONG — whether it was accepted. Only `command`/`result` are modeled; progress/result_param2/target_system/target_component are MAVLink v2 extension fields this app doesn't read (payloadLength is still the full official 10 bytes, matching this file's convention for every other message here — see the header comment). */
export const COMMAND_ACK: MessageDef = {
  id: 77,
  name: 'COMMAND_ACK',
  payloadLength: 10,
  crcExtra: 143,
  fields: [
    { name: 'command', offset: 0, type: 'uint16' },
    { name: 'result', offset: 2, type: 'uint8' },
  ],
}

/** Registry keyed by MSG_ID, for the incoming-frame decoder. */
export const MESSAGE_REGISTRY: Record<number, MessageDef> = Object.fromEntries(
  [
    HEARTBEAT,
    SYS_STATUS,
    GPS_RAW_INT,
    ATTITUDE,
    VFR_HUD,
    WIND,
    GLOBAL_POSITION_INT,
    MISSION_REQUEST,
    MISSION_REQUEST_LIST,
    MISSION_COUNT,
    MISSION_ITEM_REACHED,
    MISSION_ACK,
    MISSION_REQUEST_INT,
    MISSION_ITEM_INT,
    SET_MODE,
    COMMAND_LONG,
    COMMAND_ACK,
  ].map((def) => [def.id, def]),
)

// MAV_FRAME (only the one we use — global position, relative altitude).
export const MAV_FRAME_GLOBAL_RELATIVE_ALT_INT = 3

// MAV_CMD (only the ones we use — a plain navigation waypoint, and arm/disarm).
export const MAV_CMD_NAV_WAYPOINT = 16
export const MAV_CMD_COMPONENT_ARM_DISARM = 400

// MAV_MISSION_RESULT (only the ones the UI distinguishes).
export const MAV_MISSION_ACCEPTED = 0

// MAV_RESULT (COMMAND_ACK.result) — only the "did it work" distinction the UI needs; every non-zero code surfaces as a rejection.
export const MAV_RESULT_ACCEPTED = 0

// MAV_MODE_FLAG_SAFETY_ARMED — bit in HEARTBEAT.base_mode indicating the vehicle is currently armed.
export const MAV_MODE_FLAG_SAFETY_ARMED = 0b10000000

/**
 * ArduCopter's flight-mode numbers (HEARTBEAT.custom_mode / SET_MODE's
 * target) for the modes Route Adjust's Brake/Resume/Land/RTL buttons
 * command. Re-entering AUTO after leaving it resumes the loaded mission
 * from its current waypoint index automatically — ArduCopter's own
 * documented behavior — so "Resume" needs no MISSION_SET_CURRENT, just
 * this mode change. RTL is ArduCopter's own auto-return-and-land, used
 * as the deliberate, pilot-initiated way back to the launch point — the
 * mission itself is no longer scripted to fly home automatically (see
 * missionFromPlan.ts).
 */
export const ARDUCOPTER_MODE_ALT_HOLD = 2
export const ARDUCOPTER_MODE_AUTO = 3
export const ARDUCOPTER_MODE_RTL = 6
export const ARDUCOPTER_MODE_LAND = 9

// MAV_TYPE / MAV_AUTOPILOT / MAV_STATE — used for the heartbeat we (the GCS) send.
export const MAV_TYPE_GCS = 6
export const MAV_AUTOPILOT_INVALID = 8
export const MAV_STATE_ACTIVE = 4

// GPS_FIX_TYPE (GPS_RAW_INT.fix_type) — used to render a human-readable fix label.
export const GPS_FIX_TYPE_LABELS: Record<number, string> = {
  0: 'no GPS',
  1: 'no fix',
  2: '2D fix',
  3: '3D fix',
  4: 'DGPS',
  5: 'RTK float',
  6: 'RTK fixed',
  8: 'static',
}

// MAV_STATE (HEARTBEAT.system_status) — the vehicle's own top-level status, independent of flight mode.
export const MAV_STATE_LABELS: Record<number, string> = {
  0: 'uninitialized',
  1: 'booting',
  2: 'calibrating',
  3: 'standby',
  4: 'active',
  5: 'critical',
  6: 'emergency',
  7: 'powering off',
  8: 'flight termination',
}

/**
 * ArduCopter's custom_mode -> name mapping (HEARTBEAT.custom_mode, when
 * base_mode has MAV_MODE_FLAG_CUSTOM_MODE_ENABLED set, which ArduPilot
 * always does). This is Copter-specific by design — this project's
 * drone profiles are all multirotor sprayers — Plane/Rover number the
 * same values differently, so this table would mislabel those. Falls
 * back to "Mode N" for anything not listed rather than guessing.
 */
export const ARDUCOPTER_MODE_LABELS: Record<number, string> = {
  0: 'Stabilize',
  2: 'Alt Hold',
  3: 'Auto',
  4: 'Guided',
  5: 'Loiter',
  6: 'RTL',
  9: 'Land',
  11: 'Drift',
  13: 'Sport',
  16: 'PosHold',
  17: 'Brake',
  20: 'Guided (no GPS)',
  21: 'Smart RTL',
}

// MAV_MODE_FLAG_CUSTOM_MODE_ENABLED — bit in HEARTBEAT.base_mode indicating custom_mode is meaningful.
export const MAV_MODE_FLAG_CUSTOM_MODE_ENABLED = 0b00000001
