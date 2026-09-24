import clsx from 'clsx'
import { STEP_LABELS, WORKFLOW_STEPS, type WorkflowStep } from '@/store/useFieldStore'

interface StepperProps {
  current: WorkflowStep
  /** Steps the pilot is allowed to jump to directly (e.g. gate "simulate" behind having a plan). */
  unlocked: WorkflowStep[]
  onSelect: (step: WorkflowStep) => void
}

export function Stepper({ current, unlocked, onSelect }: StepperProps) {
  const currentIndex = WORKFLOW_STEPS.indexOf(current)

  return (
    <nav aria-label="Mission workflow" className="flex items-center gap-1">
      {WORKFLOW_STEPS.map((step, i) => {
        const isCurrent = step === current
        const isDone = i < currentIndex
        const isUnlocked = unlocked.includes(step)

        return (
          <div key={step} className="flex items-center gap-1">
            <button
              type="button"
              disabled={!isUnlocked}
              onClick={() => onSelect(step)}
              className={clsx(
                'flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium transition-colors',
                isCurrent && 'bg-brand-600 text-white',
                !isCurrent && isDone && 'text-brand-700 hover:bg-brand-50',
                !isCurrent && !isDone && isUnlocked && 'text-(--text-secondary) hover:bg-(--surface-panel-raised)',
                !isUnlocked && 'cursor-not-allowed text-(--text-muted)',
              )}
            >
              <span
                className={clsx(
                  'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors',
                  isCurrent && 'bg-white/20 text-white',
                  !isCurrent && isDone && 'bg-brand-100 text-brand-700',
                  !isCurrent && !isDone && 'bg-(--surface-panel-raised) text-(--text-muted)',
                )}
              >
                {!isCurrent && isDone ? (
                  <svg viewBox="0 0 16 16" fill="none" className="h-3 w-3" aria-hidden="true">
                    <path d="M4 8.3 6.6 10.9 12 5.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : (
                  i + 1
                )}
              </span>
              {STEP_LABELS[step]}
            </button>
            {i < WORKFLOW_STEPS.length - 1 && (
              <div className={clsx('h-px w-4', isDone ? 'bg-brand-300' : 'bg-(--border-subtle)')} />
            )}
          </div>
        )
      })}
    </nav>
  )
}
