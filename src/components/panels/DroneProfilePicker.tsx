import clsx from 'clsx'
import { NumberField } from '@/components/ui/NumberField'
import { DRONE_PRESETS } from '@/lib/geo/dronePresets'
import type { DroneProfile } from '@/lib/geo/types'
import { useFieldStore } from '@/store/useFieldStore'

/**
 * The drone-profile picker — swath/tank/speed/rate (plus altitude and
 * endurance) as live-editable fields, with a few vendor-neutral presets
 * as starting points. Nothing in the geometry core is hardcoded to
 * DEFAULT_DRONE_PROFILE anymore; this is the only place that value is
 * ever read from — everywhere else reads store.droneProfile, which this
 * panel is free to overwrite wholesale (a preset) or field-by-field (a
 * real Pixhawk-equipped drone's actual numbers, once known).
 */
export function DroneProfilePicker() {
  const droneProfile = useFieldStore((s) => s.droneProfile)
  const setDroneProfile = useFieldStore((s) => s.setDroneProfile)
  const planError = useFieldStore((s) => s.planError)

  const updateField = (field: keyof DroneProfile, value: number) => {
    setDroneProfile({ ...droneProfile, [field]: value, id: 'custom', name: 'Custom' })
  }

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-(--text-muted)">Drone profile</h3>
        <span className="text-xs text-(--text-secondary)">{droneProfile.name}</span>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {DRONE_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            onClick={() => setDroneProfile(preset)}
            className={clsx(
              'rounded-full border px-2.5 py-1 text-xs transition-colors',
              droneProfile.id === preset.id
                ? 'border-brand-400 bg-brand-50 text-brand-700'
                : 'border-(--border-subtle) text-(--text-secondary) hover:bg-(--surface-panel-raised)',
            )}
          >
            {preset.name}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <NumberField label="Swath" unit="m" value={droneProfile.swathM} onChange={(v) => updateField('swathM', v)} />
        <NumberField label="Tank" unit="L" value={droneProfile.tankL} onChange={(v) => updateField('tankL', v)} />
        <NumberField label="Speed" unit="m/s" value={droneProfile.speedMps} onChange={(v) => updateField('speedMps', v)} />
        <NumberField label="Rate" unit="L/ha" value={droneProfile.applicationRateLPerHa} onChange={(v) => updateField('applicationRateLPerHa', v)} />
        <NumberField label="Altitude" unit="m" value={droneProfile.altitudeM} onChange={(v) => updateField('altitudeM', v)} />
        <NumberField label="Endurance" unit="min" value={droneProfile.enduranceMin} onChange={(v) => updateField('enduranceMin', v)} />
      </div>

      {planError && <p className="text-xs text-danger">Invalid profile — {planError}</p>}
    </section>
  )
}
