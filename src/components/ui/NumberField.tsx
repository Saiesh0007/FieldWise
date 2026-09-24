import { useEffect, useState } from 'react'

interface NumberFieldProps {
  label: string
  unit: string
  value: number
  min?: number
  step?: number
  onChange: (value: number) => void
}

/**
 * A controlled number input that doesn't fight the user while they're
 * typing. A naive `value={value} onChange={commit-immediately}` snaps
 * back to the last valid number the instant the field is momentarily
 * empty or "0" (e.g. while backspacing to retype), making it impossible
 * to clear and re-enter a value. This keeps free-form text locally and
 * only commits (or reverts) on blur/Enter.
 */
export function NumberField({ label, unit, value, min = 0.01, step = 0.1, onChange }: NumberFieldProps) {
  const [text, setText] = useState(String(value))

  useEffect(() => {
    setText(String(value))
  }, [value])

  const commit = () => {
    const num = Number(text)
    if (Number.isFinite(num) && num >= min) {
      onChange(num)
    } else {
      setText(String(value)) // invalid — revert rather than propagate
    }
  }

  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="text-(--text-muted)">{label}</span>
      <div className="flex items-center gap-1.5">
        <input
          type="number"
          min={min}
          step={step}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          }}
          className="w-full rounded-(--radius-control) border border-(--border-subtle) bg-(--surface-panel) px-2 py-1 text-sm tabular-nums transition-colors focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
        />
        <span className="text-(--text-muted)">{unit}</span>
      </div>
    </label>
  )
}
