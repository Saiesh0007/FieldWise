import clsx from 'clsx'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { StatCard } from '@/components/ui/StatCard'
import { splitPlanPasses } from '@/lib/geo/planner'
import type { LatLng } from '@/lib/geo/types'
import { sprayPlanToWaypoints } from '@/lib/vehicle/missionFromPlan'
import { PiRelayVehicle } from '@/lib/vehicle/piRelayVehicle'
import type { ConnectionState, FlightModeCommand, MissionUploadResult, VehicleLink, VehicleTelemetry } from '@/lib/vehicle/types'
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
  const planSplitPercent = useFieldStore((s) => s.planSplitPercent)
  const planSplitDirection = useFieldStore((s) => s.planSplitDirection)
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
  const [armSliderValue, setArmSliderValue] = useState(0)
  const [commandBusy, setCommandBusy] = useState<null | 'arm' | 'disarm' | 'brake' | 'resume' | 'land'>(null)
  const [commandError, setCommandError] = useState<string | null>(null)

  useEffect(() => {
    // A fresh vehicle instance (switching connection mode, or editing the
    // bridge URL) starts disconnected — reset the displayed state rather
    // than leaving the previous instance's last-known state on screen.
    setConnectionState(vehicle.getConnectionState())
    setTelemetry(EMPTY_TELEMETRY)
    setConnectError(null)
    setArmSliderValue(0)
    setCommandBusy(null)
    setCommandError(null)

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

  const uploadSplit = splitPlanPasses(sprayPlan, planSplitPercent, planSplitDirection)
  const isSplitActive = planSplitPercent < 100

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
      // Plan Splitting (§11.8): when the pilot has marked only part of the
      // route for this sortie, upload just that subset — the rest is
      // deferred to a later battery, not sent at all. At 100% (the
      // default) `included` is every pass, so this is a no-op.
      const waypoints = sprayPlanToWaypoints(uploadSplit.included, projection, droneProfile.altitudeM)
      const result = await vehicle.uploadAndVerifyMission(waypoints)
      setUploadResult(result)
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Mission upload failed.')
    } finally {
      setUploading(false)
    }
  }

  // Slide-to-arm — the drag itself is the confirmation, so no extra
  // dialog on top of it. Disarm and Land are single actions but each
  // physically significant in its own way (disarming while flying is
  // dangerous; landing aborts whatever the mission was doing), so both
  // get an explicit confirm. Brake and Resume are meant to be fast,
  // single-tap safety actions — gating those behind a dialog would work
  // against the point of having them.
  const handleArmSliderChange = async (value: number) => {
    setArmSliderValue(value)
    if (value < 100 || commandBusy) return
    setCommandBusy('arm')
    setCommandError(null)
    try {
      await vehicle.armDisarm(true)
    } catch (err) {
      setCommandError(err instanceof Error ? err.message : 'Arm command failed.')
    } finally {
      setCommandBusy(null)
      setArmSliderValue(0)
    }
  }

  const handleDisarm = async () => {
    if (!window.confirm('Disarm the vehicle now?')) return
    setCommandBusy('disarm')
    setCommandError(null)
    try {
      await vehicle.armDisarm(false)
    } catch (err) {
      setCommandError(err instanceof Error ? err.message : 'Disarm command failed.')
    } finally {
      setCommandBusy(null)
    }
  }

  const handleSetMode = async (mode: FlightModeCommand, busyLabel: 'brake' | 'resume' | 'land') => {
    setCommandBusy(busyLabel)
    setCommandError(null)
    try {
      await vehicle.setFlightMode(mode)
    } catch (err) {
      setCommandError(err instanceof Error ? err.message : `${busyLabel} command failed.`)
    } finally {
      setCommandBusy(null)
    }
  }

  const handleLand = async () => {
    if (!window.confirm('Land the vehicle now? This ends whatever the mission was doing.')) return
    await handleSetMode('land', 'land')
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

      {connectionState === 'connected' && (
        <section className="space-y-3 rounded-(--radius-card) border border-(--border-subtle) bg-(--surface-panel) p-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-(--text-muted)">Flight controls</h3>
            {telemetry.armed !== null && (
              <span
                className={clsx(
                  'rounded-full px-2 py-0.5 text-xs font-medium',
                  telemetry.armed ? 'bg-danger-bg text-danger' : 'bg-(--surface-panel-raised) text-(--text-muted)',
                )}
              >
                {telemetry.armed ? 'ARMED' : 'Disarmed'}
              </span>
            )}
          </div>

          {telemetry.armed ? (
            <Button size="sm" variant="danger" disabled={commandBusy !== null} onClick={() => void handleDisarm()}>
              {commandBusy === 'disarm' && <Spinner />}
              Disarm
            </Button>
          ) : (
            <div className="space-y-1">
              <input
                type="range"
                min={0}
                max={100}
                className="w-full accent-danger"
                value={armSliderValue}
                disabled={commandBusy !== null}
                onChange={(e) => void handleArmSliderChange(Number(e.target.value))}
                // A slider a pilot only drags with a mouse/finger should
                // never silently "complete" from a keyboard arrow key or
                // a scroll — arming is exactly the wrong place for that.
                onKeyDown={(e) => e.preventDefault()}
                onWheel={(e) => e.preventDefault()}
              />
              <p className="text-center text-xs text-(--text-muted)">
                {commandBusy === 'arm' ? 'Arming…' : 'Slide all the way to arm'}
              </p>
            </div>
          )}

          <div className="grid grid-cols-3 gap-2">
            <Button size="sm" variant="secondary" disabled={commandBusy !== null} onClick={() => void handleSetMode('alt-hold', 'brake')}>
              {commandBusy === 'brake' && <Spinner />}
              Brake
            </Button>
            <Button size="sm" variant="secondary" disabled={commandBusy !== null} onClick={() => void handleSetMode('auto', 'resume')}>
              {commandBusy === 'resume' && <Spinner />}
              Resume
            </Button>
            <Button size="sm" variant="danger" disabled={commandBusy !== null} onClick={() => void handleLand()}>
              {commandBusy === 'land' && <Spinner />}
              Land
            </Button>
          </div>
          <p className="text-xs text-(--text-muted)">
            Brake holds altitude in place (Alt Hold). Resume picks the loaded mission back up from wherever it left
            off (Auto). Land begins landing immediately.
          </p>

          {commandError && <p className="text-xs text-danger">{commandError}</p>}
        </section>
      )}

      <div className="h-px bg-(--border-subtle)" />

      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-(--text-muted)">Upload mission</h3>
        <p className="text-xs text-(--text-secondary)">
          {isSplitActive
            ? `Sends only this sortie's ${uploadSplit.included.length} of ${uploadSplit.included.length + uploadSplit.excluded.length} legs (Plan Splitting is active — see Plan), then downloads them back to verify the upload took.`
            : `Sends the current plan's ${uploadSplit.included.length} legs as waypoints, then downloads them back to verify the upload took.`}
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

        {uploadResult && telemetry.lastReachedWaypointSeq !== null && (() => {
          const total = uploadResult.uploadedCount
          const reached = Math.min(telemetry.lastReachedWaypointSeq, total - 1)
          const pct = total > 0 ? ((reached + 1) / total) * 100 : 0
          const complete = reached >= total - 1
          return (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs text-(--text-secondary)">
                <span>Mission progress — waypoint {reached + 1} of {total}</span>
                <span>{pct.toFixed(0)}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-(--surface-panel-raised)">
                <div className={clsx('h-full rounded-full', complete ? 'bg-success' : 'bg-brand-600')} style={{ width: `${pct}%` }} />
              </div>
              {complete && (
                <p className="text-xs font-medium text-success">Finish point reached — mission 100% complete.</p>
              )}
            </div>
          )
        })()}
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
