#!/usr/bin/env node
/**
 * FieldWise Pi Bridge — runs on the Raspberry Pi that's physically wired
 * to the Pixhawk over USB. Opens that serial port and relays the raw
 * MAVLink byte stream, unmodified, in both directions, to exactly one
 * connected WebSocket client at a time. FieldWise's browser app (running
 * on a different computer, since there's no telemetry radio and the Pi
 * is only reachable over SSH) connects to this bridge instead of using
 * Web Serial directly.
 *
 * This script does not parse or understand MAVLink at all — it is a
 * dumb byte pipe. All protocol logic (heartbeats, mission upload,
 * telemetry decoding) already lives in the browser app's MavlinkSession
 * and runs unchanged over this transport, exactly as it does over Web
 * Serial. See src/lib/vehicle/piRelayVehicle.ts for the browser side.
 *
 * Usage on the Pi:
 *   npm install
 *   node serial-ws-bridge.mjs --serial /dev/ttyACM0 --baud 115200 --port 8765
 *
 * No-hardware smoke test (proves the bridge + browser WebSocket plumbing
 * works, without a real Pixhawk attached — does NOT exercise mission
 * upload, only the heartbeat/telemetry path):
 *   node serial-ws-bridge.mjs --mock --port 8765
 *
 * See README.md for finding the right --serial path, running this
 * persistently after you log out of SSH, and an important safety note
 * about this being an unauthenticated relay.
 */
import { WebSocketServer } from 'ws'

// ---------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------

function parseArgs(argv) {
  const args = { serial: null, baud: 115200, port: 8765, mock: false, help: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--serial') args.serial = argv[++i]
    else if (a === '--baud') args.baud = Number(argv[++i])
    else if (a === '--port') args.port = Number(argv[++i])
    else if (a === '--mock') args.mock = true
    else if (a === '--help' || a === '-h') args.help = true
    else {
      console.error(`Unknown argument: ${a}`)
      args.help = true
    }
  }
  return args
}

function printHelp() {
  console.log(`FieldWise Pi Bridge

  --serial <path>   Pixhawk's serial device, e.g. /dev/ttyACM0 (required unless --mock)
  --baud <rate>      Baud rate (default: 115200)
  --port <port>      WebSocket port to listen on (default: 8765)
  --mock             No real hardware — emit a fake HEARTBEAT every second
                      instead of opening a serial port, to smoke-test the
                      bridge + browser connection. Does not support mission
                      upload/download.

Examples:
  node serial-ws-bridge.mjs --serial /dev/ttyACM0
  node serial-ws-bridge.mjs --mock
`)
}

const args = parseArgs(process.argv.slice(2))
if (args.help || (!args.mock && !args.serial)) {
  printHelp()
  process.exit(args.help ? 0 : 1)
}

function log(...parts) {
  console.log(`[${new Date().toISOString()}]`, ...parts)
}

// ---------------------------------------------------------------------
// Mock HEARTBEAT frame — a hand-built MAVLink v2 HEARTBEAT, byte-for-
// byte the same framing/CRC algorithm as src/lib/vehicle/mavlink/{crc,codec}.ts
// (transcribed here, not reimplemented independently, since this bridge
// is a separate Node package from the browser app and can't import its
// TypeScript source directly). Only exists for --mock; a real Pixhawk
// sends its own real heartbeats over the actual serial link.
// ---------------------------------------------------------------------

const CRC_INITIAL = 0xffff

function crcAccumulate(byte, crc) {
  let tmp = (byte ^ (crc & 0xff)) & 0xff
  tmp = (tmp ^ (tmp << 4)) & 0xff
  return ((crc >> 8) ^ (tmp << 8) ^ (tmp << 3) ^ (tmp >> 4)) & 0xffff
}

function crc16X25(bytes, start, trim, crcExtra) {
  let crc = CRC_INITIAL
  for (let i = start; i < bytes.length - trim; i++) crc = crcAccumulate(bytes[i], crc)
  crc = crcAccumulate(crcExtra, crc)
  return crc
}

const HEARTBEAT_CRC_EXTRA = 50
const MAV_TYPE_QUADROTOR = 2
const MAV_AUTOPILOT_ARDUPILOTMEGA = 3
const MAV_MODE_FLAG_CUSTOM_MODE_ENABLED = 1
const MAV_STATE_ACTIVE = 4

function buildMockHeartbeatFrame(seq) {
  const payload = new Uint8Array(9)
  const view = new DataView(payload.buffer)
  view.setUint32(0, 0, true) // customMode: 0 (STABILIZE)
  view.setUint8(4, MAV_TYPE_QUADROTOR)
  view.setUint8(5, MAV_AUTOPILOT_ARDUPILOTMEGA)
  view.setUint8(6, MAV_MODE_FLAG_CUSTOM_MODE_ENABLED)
  view.setUint8(7, MAV_STATE_ACTIVE)
  view.setUint8(8, 3) // mavlinkVersion

  const HEADER_LENGTH = 10
  const frame = new Uint8Array(HEADER_LENGTH + payload.length + 2)
  frame[0] = 0xfd // STX
  frame[1] = payload.length
  frame[2] = 0 // incompat flags
  frame[3] = 0 // compat flags
  frame[4] = seq & 0xff
  frame[5] = 1 // sysid — a plausible ArduCopter default
  frame[6] = 1 // compid — MAV_COMP_ID_AUTOPILOT1
  frame[7] = 0 // msgid low byte — HEARTBEAT is message 0
  frame[8] = 0
  frame[9] = 0
  frame.set(payload, HEADER_LENGTH)

  const crc = crc16X25(frame.subarray(0, HEADER_LENGTH + payload.length), 1, 0, HEARTBEAT_CRC_EXTRA)
  new DataView(frame.buffer).setUint16(HEADER_LENGTH + payload.length, crc, true)

  return Buffer.from(frame)
}

// ---------------------------------------------------------------------
// Byte source — either the real serial port, or the mock heartbeat timer.
// Both expose the same tiny interface: onData(cb), write(bytes), close().
// ---------------------------------------------------------------------

async function openByteSource() {
  if (args.mock) {
    log('MOCK MODE — no real serial port opened. Emitting a fake HEARTBEAT every second.')
    log('This proves the bridge <-> browser WebSocket path works, but does NOT support mission upload.')
    let seq = 0
    let dataListener = null
    const timer = setInterval(() => {
      if (dataListener) dataListener(buildMockHeartbeatFrame(seq++))
    }, 1000)
    return {
      onData: (cb) => {
        dataListener = cb
      },
      write: (bytes) => {
        log(`(mock) received ${bytes.length} bytes from a client — ignored, mock mode doesn't emulate mission upload.`)
      },
      close: async () => {
        clearInterval(timer)
      },
    }
  }

  const { SerialPort } = await import('serialport')
  const port = new SerialPort({ path: args.serial, baudRate: args.baud })

  await new Promise((resolve, reject) => {
    port.once('open', resolve)
    port.once('error', reject)
  })
  log(`Serial port ${args.serial} open at ${args.baud} baud.`)

  return {
    onData: (cb) => port.on('data', cb),
    write: (bytes) => port.write(Buffer.from(bytes)),
    close: () => new Promise((resolve) => port.close(() => resolve())),
  }
}

// ---------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------

async function main() {
  const source = await openByteSource()

  const wss = new WebSocketServer({ port: args.port })
  log(`WebSocket relay listening on ws://0.0.0.0:${args.port}`)
  log('Point FieldWise at ws://<this Pi\'s IP address>:' + args.port + ' from the "Pi Bridge" connection option.')

  let activeClient = null

  source.onData((bytes) => {
    if (activeClient && activeClient.readyState === activeClient.OPEN) {
      activeClient.send(bytes)
    }
  })

  wss.on('connection', (ws, req) => {
    if (activeClient) {
      log(`Rejected a second connection from ${req.socket.remoteAddress} — one FieldWise session at a time, to avoid two ground stations sending conflicting commands to the same vehicle.`)
      ws.close(1013, 'Bridge already has an active connection')
      return
    }

    activeClient = ws
    log(`FieldWise connected from ${req.socket.remoteAddress}.`)

    ws.on('message', (data, isBinary) => {
      if (!isBinary) return // ignore any stray text frames — MAVLink is always binary
      source.write(data)
    })

    ws.on('close', () => {
      log('FieldWise disconnected.')
      if (activeClient === ws) activeClient = null
    })

    ws.on('error', (err) => {
      log('WebSocket error:', err.message)
    })
  })

  const shutdown = async (signal) => {
    log(`${signal} received — shutting down.`)
    activeClient?.close()
    wss.close()
    await source.close()
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
}

main().catch((err) => {
  console.error('Bridge failed to start:', err)
  process.exit(1)
})
