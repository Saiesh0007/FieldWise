import type { ReactNode } from 'react'
import { ReadinessBadge } from './ReadinessBadge'
import { RecomputeTimingBadge } from './RecomputeTimingBadge'
import { SettingsMenu } from './SettingsMenu'
import { Stepper } from './Stepper'
import { useFieldStore, type WorkflowStep, WORKFLOW_STEPS } from '@/store/useFieldStore'

interface AppShellProps {
  children: ReactNode
  onOpenProjects: () => void
}

export function AppShell({ children, onOpenProjects }: AppShellProps) {
  const currentStep = useFieldStore((s) => s.currentStep)
  const setStep = useFieldStore((s) => s.setStep)
  const boundary = useFieldStore((s) => s.boundary)
  const sprayPlan = useFieldStore((s) => s.sprayPlan)
  const readiness = useFieldStore((s) => s.readiness)
  const lastRecomputeMs = useFieldStore((s) => s.lastRecomputeMs)
  const activeProjectId = useFieldStore((s) => s.activeProjectId)
  const activeProjectName = useFieldStore((s) => s.activeProjectName)

  // Gate later steps behind having the data they need — prevents the
  // pilot from landing on "Send to Vehicle" with nothing planned.
  const unlocked: WorkflowStep[] = WORKFLOW_STEPS.filter((step) => {
    if (step === 'import') return true
    if (step === 'verify') return boundary !== null
    if (step === 'plan') return boundary !== null
    if (step === 'simulate') return sprayPlan !== null
    if (step === 'export') return sprayPlan !== null
    if (step === 'send') return sprayPlan !== null
    return false
  })

  return (
    <div className="flex min-h-full flex-col bg-(--surface-app)">
      <header className="flex items-center justify-between gap-4 border-b border-(--border-subtle) bg-(--surface-panel) px-6 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">
            FW
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold text-(--text-primary)">FieldWise</div>
            <button
              type="button"
              onClick={onOpenProjects}
              className="flex items-center gap-1 text-xs text-(--text-muted) transition-colors hover:text-brand-600"
              title="Open, rename, or create projects"
            >
              <svg viewBox="0 0 16 16" fill="none" className="h-3 w-3 shrink-0" aria-hidden="true">
                <path
                  d="M2 4.5A1.5 1.5 0 0 1 3.5 3h2.6l1 1.2h5.4A1.5 1.5 0 0 1 14 5.7v6.8A1.5 1.5 0 0 1 12.5 14h-9A1.5 1.5 0 0 1 2 12.5v-8Z"
                  stroke="currentColor"
                  strokeWidth="1.3"
                />
              </svg>
              {activeProjectId ? activeProjectName : 'Projects'}
            </button>
          </div>
        </div>

        <Stepper current={currentStep} unlocked={unlocked} onSelect={setStep} />

        <div className="flex shrink-0 items-center gap-2.5">
          <RecomputeTimingBadge lastRecomputeMs={lastRecomputeMs} />
          <ReadinessBadge readiness={readiness} />
          <SettingsMenu />
        </div>
      </header>

      <main className="flex flex-1 flex-col overflow-hidden">{children}</main>
    </div>
  )
}
