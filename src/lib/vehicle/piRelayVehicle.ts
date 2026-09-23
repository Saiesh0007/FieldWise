/**
 * Pixhawk over a Raspberry Pi bridge, instead of directly over Web
 * Serial — for exactly the setup where the Pixhawk is wired to a Pi's
 * USB port, there's no telemetry radio, and the pilot's browser is on a
 * *different* machine reached only by SSHing into the Pi (so the
 * browser has no way to see the Pi's serial device at all; Web Serial
 * only works when the browser and the serial port are on the same
 * machine). `bridge/serial-ws-bridge.mjs` runs on the Pi, opens the
 * Pixhawk's serial port, and relays the raw MAVLink byte stream over a
 * WebSocket this class connects to.
 *
 * Same shape as WebSerialVehicle on purpose: this class only knows how
 * to open a WebSocket and pipe bytes in and out of a MavlinkSession —
 * every bit of protocol logic (heartbeat handling, telemetry decoding,
 * the mission upload/download handshake) is the exact same
 * already-tested code WebSerialVehicle uses, completely transport-
 * agnostic. See mavlinkSession.test.ts for what that verified.
 *
 * IMPORTANT — this class itself (the WebSocket plumbing) has been
 * verified against the real bridge script in --mock mode (a real
 * WebSocket connection, a real hand-built HEARTBEAT frame, decoded
 * correctly end-to-end) but never against a real Pixhawk. Mock mode
 * doesn't exercise mission upload/download at all. Treat every claim
 * here as "should work" until verified with real hardware — see
 * bridge/README.md and VEHICLE_CONNECTION_CHECKLIST.md.
 */
import { MavlinkSession, HEARTBEAT_STALE_MS } from './mavlinkSession'
import type { ConnectionState, FlightModeCommand, MissionUploadResult, MissionWaypoint, VehicleLink, VehicleLinkEvents } from './types'

const HEARTBEAT_INTERVAL_MS = 1000
const CONNECT_TIMEOUT_MS = 6000

export class PiRelayVehicle implements VehicleLink {
  readonly kind = 'pi-relay'

  private ws: WebSocket | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null

  private session = new MavlinkSession((bytes) => this.writeBytes(bytes))
  private connectionState: ConnectionState = 'disconnected'
  private stateListeners = new Set<VehicleLinkEvents['onConnectionStateChange']>()

  private readonly url: string

  constructor(url: string) {
    this.url = url
  }

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
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) throw new Error('Not connected.')
    // Uint8Array's `buffer` is typed ArrayBufferLike (could be a
    // SharedArrayBuffer), which WebSocket.send()'s BufferSource overload
    // doesn't accept — send a plain Uint8Array view instead, which its
    // ArrayBufferView overload does.
    this.ws.send(new Uint8Array(bytes))
  }

  async connect(): Promise<void> {
    if (this.connectionState === 'connected' || this.connectionState === 'connecting') return
    if (!this.url) throw new Error('No bridge address set — enter the Pi\'s ws://host:port address first.')

    this.setState('connecting')
    try {
      await this.openSocket()
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

  private openSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false
      const ws = new WebSocket(this.url)
      ws.binaryType = 'arraybuffer'

      ws.onopen = () => {
        settled = true
        this.ws = ws
        resolve()
      }
      ws.onerror = () => {
        if (!settled) {
          settled = true
          reject(new Error(`Could not reach the bridge at ${this.url}. Is serial-ws-bridge.mjs running on the Pi, and is this browser on the same network?`))
        }
      }
      ws.onclose = (e) => {
        if (!settled) {
          settled = true
          reject(new Error(e.reason || `Bridge closed the connection (code ${e.code}) — it may already have another client connected.`))
          return
        }
        // A close after a successful connect means the link dropped mid-session.
        this.session.cancelAllWaits('disconnected')
        this.setState('disconnected')
      }
      ws.onmessage = (e) => {
        if (e.data instanceof ArrayBuffer) this.session.feedBytes(new Uint8Array(e.data))
      }
    })
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

    if (this.ws) {
      this.ws.onopen = null
      this.ws.onerror = null
      this.ws.onclose = null
      this.ws.onmessage = null
      try {
        this.ws.close()
      } catch {
        /* already closed */
      }
    }
    this.ws = null
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
