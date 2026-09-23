/**
 * Pixhawk over USB, straight from the browser via the Web Serial API —
 * no companion computer, no native app. Chrome/Edge only (Web Serial
 * isn't implemented in Firefox or Safari as of this writing); connect()
 * throws a clear error on unsupported browsers rather than failing
 * silently.
 *
 * This class only knows how to open a serial port and pipe bytes in and
 * out of a MavlinkSession — all the protocol logic (heartbeat handling,
 * telemetry decoding, the mission upload/download handshake) lives
 * there, where it's testable against a simulated vehicle. See
 * mavlinkSession.test.ts for what that verified.
 *
 * IMPORTANT — this class itself has never been run against a real
 * Pixhawk or even a real browser Web Serial port. The protocol logic
 * underneath it is unit-tested against a simulated vehicle; the actual
 * `navigator.serial` plumbing below (requestPort/open/read loop) is
 * implemented from the Web Serial API spec and has zero automated
 * coverage, since it's not something Node/Vitest can exercise. Treat
 * every claim here as "should work" until verified with real hardware —
 * see VEHICLE_CONNECTION_CHECKLIST.md.
 */
import { MavlinkSession, HEARTBEAT_STALE_MS } from './mavlinkSession'
import type { ConnectionState, FlightModeCommand, MissionUploadResult, MissionWaypoint, VehicleLink, VehicleLinkEvents } from './types'

const HEARTBEAT_INTERVAL_MS = 1000
const CONNECT_TIMEOUT_MS = 6000
const DEFAULT_BAUD_RATE = 115200

// Minimal structural types for the Web Serial API — not yet a standard
// part of TypeScript's DOM lib, so declared here rather than pulling in
// an extra @types package for a handful of methods.
interface SerialPortLike {
  open(options: { baudRate: number }): Promise<void>
  close(): Promise<void>
  readable: ReadableStream<Uint8Array> | null
  writable: WritableStream<Uint8Array> | null
}
interface SerialLike {
  requestPort(): Promise<SerialPortLike>
}

function getSerial(): SerialLike {
  const nav = navigator as Navigator & { serial?: SerialLike }
  if (!nav.serial) {
    throw new Error('Web Serial is not available in this browser. Use Chrome or Edge, over HTTP(S) or localhost.')
  }
  return nav.serial
}

export class WebSerialVehicle implements VehicleLink {
  readonly kind = 'web-serial'

  private port: SerialPortLike | null = null
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null
  private readLoopPromise: Promise<void> | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null

  private session = new MavlinkSession((bytes) => this.writeBytes(bytes))
  private connectionState: ConnectionState = 'disconnected'
  private stateListeners = new Set<VehicleLinkEvents['onConnectionStateChange']>()

  getConnectionState(): ConnectionState {
    return this.connectionState
  }

  onTelemetry(listener: VehicleLinkEvents['onTelemetry']): () => void {
    return this.session.onTelemetry(listener)
  }
  onLog(listener: VehicleLinkEvents['onLog']): () => void {
    return this.session.onLog(listener)
  }
  onConnectionStateChange(listener: VehicleLinkEvents['onConnectionStateChange']): () => void {
    this.stateListeners.add(listener)
    return () => this.stateListeners.delete(listener)
  }

  private setState(state: ConnectionState) {
    this.connectionState = state
    for (const l of this.stateListeners) l(state)
  }

  private async writeBytes(bytes: Uint8Array): Promise<void> {
    if (!this.writer) throw new Error('Not connected.')
    await this.writer.write(bytes)
  }

  async connect(): Promise<void> {
    if (this.connectionState === 'connected' || this.connectionState === 'connecting') return

    this.setState('connecting')
    try {
      const serial = getSerial()
      const port = await serial.requestPort() // browser's native device picker
      await port.open({ baudRate: DEFAULT_BAUD_RATE })
      this.port = port

      if (!port.readable || !port.writable) {
        throw new Error('Serial port opened but has no readable/writable stream.')
      }
      this.reader = port.readable.getReader()
      this.writer = port.writable.getWriter()

      this.readLoopPromise = this.runReadLoop()
      this.heartbeatTimer = setInterval(() => void this.session.tick(), HEARTBEAT_INTERVAL_MS)
      void this.session.tick() // don't wait a full interval for the first GCS heartbeat

      await this.session.waitForHeartbeat(CONNECT_TIMEOUT_MS)
      this.setState('connected')
    } catch (err) {
      this.setState('error')
      await this.teardown()
      throw err instanceof Error ? err : new Error(String(err))
    }
  }

  async disconnect(): Promise<void> {
    await this.teardown()
    this.setState('disconnected')
  }

  private async teardown(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
    this.session.cancelAllWaits('disconnecting')

    try {
      await this.reader?.cancel()
    } catch {
      /* already closed */
    }
    this.reader?.releaseLock()
    this.reader = null

    try {
      await this.readLoopPromise
    } catch {
      /* the loop's own catch already logged this */
    }
    this.readLoopPromise = null

    try {
      this.writer?.releaseLock()
    } catch {
      /* already released */
    }
    this.writer = null

    try {
      await this.port?.close()
    } catch {
      /* already closed */
    }
    this.port = null
  }

  private async runReadLoop(): Promise<void> {
    const reader = this.reader
    if (!reader) return
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        if (value) this.session.feedBytes(value)
      }
    } catch {
      /* stream closed/errored during teardown — expected on disconnect */
    }
  }

  async uploadAndVerifyMission(waypoints: MissionWaypoint[]): Promise<MissionUploadResult> {
    if (this.connectionState !== 'connected') throw new Error('Not connected to a vehicle.')
    return this.session.uploadAndVerifyMission(waypoints)
  }

  async armDisarm(arm: boolean): Promise<void> {
    if (this.connectionState !== 'connected') throw new Error('Not connected to a vehicle.')
    return this.session.armDisarm(arm)
  }

  async setFlightMode(mode: FlightModeCommand): Promise<void> {
    if (this.connectionState !== 'connected') throw new Error('Not connected to a vehicle.')
    return this.session.setFlightMode(mode)
  }
}

export { HEARTBEAT_STALE_MS }
