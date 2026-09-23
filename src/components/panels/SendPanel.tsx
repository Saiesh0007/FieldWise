import clsx from 'clsx'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { StatCard } from '@/components/ui/StatCard'
import type { LatLng } from '@/lib/geo/types'
import { sprayPlanToWaypoints } from '@/lib/vehicle/missionFromPlan'
import { PiRelayVehicle } from '@/lib/vehicle/piRelayVehicle'
import type { ConnectionState, MissionUploadResult, VehicleLink, VehicleTelemetry } from '@/lib/vehicle/types'
import { EMPTY_TELEMETRY } from '@/lib/vehicle/types'
import { WebSerialVehicle } from '@/lib/vehicle/webSerialVehicle'
import { useFieldStore } from '@/store/useFieldStore'

type ConnectionMode = 'web-serial' | 'pi-relay'
const BRIDGE_URL_STORAGE_KEY = 'fieldwise-bridge-url'

const STATE_LABEL: Record<ConnectionState, string> = {
  disconnected: 'Not connected',
  connecting: 'Connecting…',
  connected: 'Connected',
  error: 'Connection failed',
}
const STATE_CLASSES: Record<ConnectionState, string> = {
  disconnected: 'bg-(--surface-panel-raised) text-(--text-muted)',
  connecting: 'bg-provenance-walked-bg text-provenance-walked',
  connected: 'bg-success-bg text-success',
  error: 'bg-danger-bg text-danger',
}

function webSerialSupported(): boolean {
  return typeof navigator !== 'undefined' && 'serial' in navigator
}

/** A minimal artificial-horizon indicator — rotates with roll, shifts with pitch. Real MAVLink ATTITUDE data, not simulated. */
function AttitudeIndicator({ rollDeg, pitchDeg }: { rollDeg: number; pitchDeg: number }) {
  const clampedPitch = Math.max(-30, Math.min(30, pitchDeg))
  return (
    <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-full border-2 border-(--border-subtle) bg-ink-200">
      <div
        className="absolute inset-[-50%]"
        style={{ transform: `rotate(${-rollDeg}deg) translateY(${clampedPitch * 1.2}px)` }}
      >
        <div className="absolute inset-0 top-1/2 bg-brand-600" />
        <div className="absolute inset-0 bottom-1/2 bg-sky-300" style={{ background: '#bfe3fb' }} />
        <div className="absolute left-0 right-0 top-1/2 h-px -translate-y-1/2 bg-white/70" />
      </div>
      <div className="absolute left-1/2 top-1/2 h-2 w-8 -translate-x-1/2 -translate-y-1/2 border-y-2 border-white" />
    </div>
  )
}

/** AeroGCS Green's "Head Direction" widget — a compass dial rotated by VFR_HUD.heading. Real MAVLink data, not simulated. */
function HeadingCompass({ headingDeg }: { headingDeg: number }) {
  return (
    <div className="relative h-20 w-20 shrink-0 rounded-full border-2 border-(--border-subtle) bg-ink-100">
      <div className="absolute inset-0 flex items-center justify-center text-[9px] font-medium text-(--text-muted)">
        <span className="absolute top-1">N</span>
        <span className="absolute bottom-1">S</span>
        <span className="absolute left-1">W</span>
        <span className="absolute right-1">E</span>
      </div>
      <div className="absolute inset-0 transition-transform" style={{ transform: `rotate(${headingDeg}deg)` }}>
        <div className="absolute left-1/2 top-2 h-6 w-0 -translate-x-1/2 border-l-2 border-danger" />
      </div>
      <div className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-(--text-primary)" />
      <div className="absolute bottom-0.5 left-1/2 -translate-x-1/2 text-[9px] font-semibold tabular-nums text-(--text-primary)">
        {Math.round(headingDeg)}°
      </div>
    </div>
  )
}

interface SendPanelProps {
  /** AeroGCS Green's "Drone Location" button — recenters the map on the vehicle's current GPS fix. Only ever called with a non-null position (the button that triggers it is itself gated on telemetry.gps.position existing). */
  onCenterOnDrone: (position: LatLng) => void
}

export function SendPanel({ onCenterOnDrone }: SendPanelProps) {
  const boundary = useFieldStore((s) => s.boundary)
  const sprayPlan = useFieldStore((s) => s.sprayPlan)
  const projection = useFieldStore((s) => s.projection)
  const droneProfile = useFieldStore((s) => s.droneProfile)

  const [connectionMode, setConnectionMode] = useState<ConnectionMode>('web-serial')
  const [bridgeUrl, setBridgeUrl] = useState<string>(() => {
    try {
      return localStorage.getItem(BRIDGE_URL_STORAGE_KEY) ?? ''
    } catch {
      return ''
    }
  })
  const vehicle: VehicleLink = useMemo(
    () => (connectionMode === 'web-serial' ? new WebSerialVehicle() : new PiRelayVehicle(bridgeUrl)),
    [connectionMode, bridgeUrl],
  )
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected')
  const [telemetry, setTelemetry] = useState<VehicleTelemetry>(EMPTY_TELEMETRY)
  const [connectError, setConnectError] = useState<string | null>(null)
  const [logLines, setLogLines] = useState<string[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadResult, setUploadResult] = useState<MissionUploadResult | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)

  useEffect(() => {
    // A fresh vehicle instance (switching connection mode, or editing the
    // bridge URL) starts disconnected — reset the displayed state rather
    // than leaving the previous instance's last-known state on screen.
    setConnectionState(vehicle.getConnectionState())
    setTelemetry(EMPTY_TELEMETRY)
    setConnectError(null)

    const offTelemetry = vehicle.onTelemetry(setTelemetry)
    const offState = vehicle.onConnectionStateChange(setConnectionState)
    const offLog = vehicle.onLog((msg) => setLogLines((prev) => [...prev.slice(-19), msg]))
    return () => {
      offTelemetry()
      offState()
      offLog()
      void vehicle.disconnect() // don't leave a serial port / bridge socket open if the pilot navigates away or switches connection mode
    }
  }, [vehicle])

  // Dev-only debug hook (never ships in production builds, same pattern
  // as FieldMap's __fieldwiseMap) — lets a browser-driven verification
  // script render the live-telemetry widgets without real Pixhawk
  // hardware, which Web Serial has no way to fake from outside the
  // browser.
  useEffect(() => {
    if (!import.meta.env.DEV) return
    ;(window as unknown as { __fieldwiseSeedTelemetry?: (t: Partial<VehicleTelemetry>, connected?: boolean) => void }).__fieldwiseSeedTelemetry = (
      partial,
      connected = true,
    ) => {
      setTelemetry((prev) => ({ ...prev, ...partial }))
      if (connected) setConnectionState('connected')
    }
  }, [])

  if (!boundary || !sprayPlan) {
    return <div className="p-4 text-sm text-(--text-secondary)">No plan yet — go back to Plan.</div>
  }

  const handleConnect = async () => {
    setConnectError(null)
    try {
      await vehicle.connect()
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : 'Failed to connect.')
    }
  }

  const handleUpload = async () => {
    if (!projection) return
    setUploading(true)
    setUploadError(null)
    setUploadResult(null)
    try {
      const waypoints = sprayPlanToWaypoints(sprayPlan, projection, droneProfile.altitudeM)
      const result = await vehicle.uploadAndVerifyMission(waypoints)
      setUploadResult(result)
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Mission upload failed.')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <div>
        <h2 className="text-sm font-semibold text-(--text-primary)">Send to vehicle</h2>
        <p className="mt-1 text-xs text-(--text-secondary)">
          Connect a Pixhawk directly over USB (Web Serial), or through a Raspberry Pi bridge if there's no telemetry
          radio and the Pi is only reachable by SSH. This link is unverified against real hardware; see the
          connection checklist.
        </p>
      </div>

      <div className="flex gap-2">
        <label className="flex flex-1 cursor-pointer items-center gap-1.5 rounded-(--radius-control) border border-(--border-subtle) px-2.5 py-1.5 text-sm text-(--text-primary)">
          <input
            type="radio"
            className="h-3.5 w-3.5 accent-brand-600"
            checked={connectionMode === 'web-serial'}
            disabled={connectionState !== 'disconnected' && connectionState !== 'error'}
            onChange={() => setConnectionMode('web-serial')}
          />
          USB (Web Serial)
        </label>
        <label className="flex flex-1 cursor-pointer items-center gap-1.5 rounded-(--radius-control) border border-(--border-subtle) px-2.5 py-1.5 text-sm text-(--text-primary)">
          <input
            type="radio"
            className="h-3.5 w-3.5 accent-brand-600"
            checked={connectionMode === 'pi-relay'}
            disabled={connectionState !== 'disconnected' && connectionState !== 'error'}
            onChange={() => setConnectionMode('pi-relay')}
          />
          Pi bridge
        </label>
      </div>

      {connectionMode === 'web-serial' && !webSerialSupported() && (
        <div className="rounded-(--radius-card) border border-warning/30 bg-warning-bg p-3 text-xs text-warning">
          Web Serial isn't available in this browser. Open this page in Chrome or Edge to connect a Pixhawk.
        </div>
      )}

      {connectionMode === 'pi-relay' && (
        <div className="space-y-1.5">
          <input
            type="text"
            inputMode="url"
            placeholder="ws://raspberrypi.local:8765"
            className="w-full rounded-(--radius-control) border border-(--border-subtle) bg-(--surface-panel) px-2.5 py-1.5 text-sm transition-colors focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
            value={bridgeUrl}
            disabled={connectionState !== 'disconnected' && connectionState !== 'error'}
            onChange={(e) => {
              setBridgeUrl(e.target.value)
              try {
                localStorage.setItem(BRIDGE_URL_STORAGE_KEY, e.target.value)
              } catch {
                /* private browsing / storage disabled — the address just won't be remembered next visit */
              }
            }}
          />
          <p className="text-xs text-(--text-muted)">
            The address serial-ws-bridge.mjs printed when you started it on the Pi (run <code>hostname -I</code> on
            the Pi if you don't know its address). Requires this browser's machine and the Pi to be on the same
            network.
          </p>
        </div>
      )}

      <div className="flex items-center justify-between rounded-(--radius-card) border border-(--border-subtle) bg-(--surface-panel) p-3">
        <span className={clsx('flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium', STATE_CLASSES[connectionState])}>
          {connectionState === 'connecting' && <Spinner />}
          {STATE_LABEL[connectionState]}
        </span>
        {connectionState === 'connected' ? (
          <Button size="sm" variant="secondary" onClick={() => void vehicle.disconnect()}>
            Disconnect
          </Button>
        ) : (
          <Button
            size="sm"
            variant="primary"
            disabled={
              connectionState === 'connecting' ||
              (connectionMode === 'web-serial' && !webSerialSupported()) ||
              (connectionMode === 'pi-relay' && bridgeUrl.trim() === '')
            }
            onClick={handleConnect}
          >
            Connect Pixhawk
          </Button>
        )}
      </div>
      {connectError && <p className="text-xs text-danger">{connectError}</p>}

      {connectionState === 'connected' && (
        <section className="space-y-2 rounded-(--radius-card) border border-(--border-subtle) bg-(--surface-panel) p-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-(--text-muted)">Live telemetry</h3>

          {(telemetry.flightMode !== null || telemetry.systemStatus !== null) && (
            <div className="flex items-center gap-1.5">
              {telemetry.flightMode !== null && (
                <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">{telemetry.flightMode}</span>
              )}
              {telemetry.systemStatus !== null && (
                <span
                  className={clsx(
                    'rounded-full px-2 py-0.5 text-xs font-medium',
                    telemetry.systemStatus === 'active' ? 'bg-success-bg text-success' : 'bg-(--surface-panel-raised) text-(--text-secondary)',
                  )}
                >
                  {telemetry.systemStatus}
                </span>
              )}
            </div>
          )}

          <div className="flex items-center gap-3">
            {telemetry.attitude ? (
              <AttitudeIndicator rollDeg={telemetry.attitude.rollDeg} pitchDeg={telemetry.attitude.pitchDeg} />
            ) : (
              <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full border-2 border-dashed border-(--border-subtle) text-[10px] text-(--text-muted)">
                no attitude
              </div>
            )}
            {telemetry.headingDeg !== null && <HeadingCompass headingDeg={telemetry.headingDeg} />}
            <div className="grid flex-1 grid-cols-2 gap-2">
              <StatCard
                label="GPS fix"
                value={telemetry.gps.fixType}
                hint={telemetry.gps.satellites !== null ? `${telemetry.gps.satellites} sats` : undefined}
              />
              <StatCard label="HDOP" value={telemetry.gps.hdop !== null ? telemetry.gps.hdop.toFixed(1) : '—'} />
              {telemetry.attitude && (
                <>
                  <StatCard label="Roll" value={telemetry.attitude.rollDeg.toFixed(0)} unit="°" />
                  <StatCard label="Pitch" value={telemetry.attitude.pitchDeg.toFixed(0)} unit="°" />
                </>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <StatCard
              label="Battery"
              value={telemetry.battery?.voltageV !== null && telemetry.battery?.voltageV !== undefined ? telemetry.battery.voltageV.toFixed(1) : '—'}
              unit="V"
              hint={telemetry.battery?.remainingPct !== null && telemetry.battery?.remainingPct !== undefined ? `${telemetry.battery.remainingPct}% remaining` : undefined}
            />
            <StatCard label="Altitude" value={telemetry.altitudeM !== null ? telemetry.altitudeM.toFixed(1) : '—'} unit="m AGL" />
            <StatCard
              label="Wind"
              value={telemetry.wind ? telemetry.wind.speedMps.toFixed(1) : '—'}
              unit={telemetry.wind ? 'm/s' : undefined}
              hint={telemetry.wind ? `from ${Math.round(telemetry.wind.directionDeg)}°` : 'not sent by this vehicle'}
            />
          </div>

          {telemetry.gps.position && (
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-(--text-secondary)">
                {telemetry.gps.position.lat.toFixed(6)}, {telemetry.gps.position.lon.toFixed(6)}
              </span>
              <Button size="sm" variant="ghost" onClick={() => onCenterOnDrone(telemetry.gps.position!)}>
                Center map on drone
              </Button>
            </div>
          )}
          <div className="text-[11px] text-(--text-muted)">
            {telemetry.heartbeatOk ? 'Heartbeat OK' : 'No recent heartbeat'}
            {telemetry.heartbeatAgeMs !== null && ` · ${Math.round(telemetry.heartbeatAgeMs / 1000)}s ago`}
          </div>
        </section>
      )}

      <div className="h-px bg-(--border-subtle)" />

      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-(--text-muted)">Upload mission</h3>
        <p className="text-xs text-(--text-secondary)">
          Sends the current plan's {sprayPlan.sorties.reduce((s, sortie) => s + sortie.passes.length, 0)} legs as
          waypoints, then downloads them back to verify the upload took.
        </p>
        <Button variant="primary" disabled={connectionState !== 'connected' || uploading} onClick={handleUpload}>
          {uploading && <Spinner className="text-white" />}
          {uploading ? 'Uploading…' : 'Upload mission'}
        </Button>

        {uploadError && <p className="text-xs text-danger">{uploadError}</p>}

        {uploadResult && (
          <div
            className={clsx(
              'rounded-(--radius-card) border p-3 text-sm',
              uploadResult.verified ? 'border-success/30 bg-success-bg text-success' : 'border-danger/30 bg-danger-bg text-danger',
            )}
          >
            {uploadResult.verified
              ? `Verified — ${uploadResult.uploadedCount}/${uploadResult.uploadedCount} waypoints read back match.`
              : `${uploadResult.mismatches.length} mismatch(es) — ${uploadResult.mismatches[0]?.reason ?? ''}`}
          </div>
        )}
      </section>

      <div className="h-px bg-(--border-subtle)" />

      <section className="space-y-1">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-(--text-muted)">Log</h3>
        <div className="max-h-32 space-y-0.5 overflow-y-auto rounded-(--radius-control) bg-ink-900 p-2 font-mono text-[10px] text-ink-100">
          {logLines.length === 0 ? <div className="text-ink-500">—</div> : logLines.map((line, i) => <div key={i}>{line}</div>)}
        </div>
      </section>
    </div>
  )
}
