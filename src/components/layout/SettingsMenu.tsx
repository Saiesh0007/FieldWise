import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/Button'
import { deleteProject, listProjects, setActiveProjectId } from '@/lib/storage/projectDb'
import { useFieldStore } from '@/store/useFieldStore'

/**
 * AeroGCS Green's three-dot menu: Cloud Sync, Settings, Drone
 * Connection. Cloud Sync is deliberately a visible-but-inert stub here,
 * not a real feature — FieldWise's whole pitch is zero-cloud/offline-
 * first (docs/Rules.md Rule 1), and a genuine sync would mean standing
 * up a backend that contradicts it. Kept visible (rather than omitted)
 * because the plan is to revisit it later, not to pretend the menu item
 * doesn't exist.
 */
export function SettingsMenu() {
  const [open, setOpen] = useState(false)
  const [modal, setModal] = useState<'settings' | 'cloud-sync' | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const setStep = useFieldStore((s) => s.setStep)

  useEffect(() => {
    if (!open) return
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  return (
    <>
      <div ref={menuRef} className="relative">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex h-7 w-7 items-center justify-center rounded-full text-(--text-muted) transition-colors hover:bg-(--surface-panel-raised) hover:text-(--text-primary)"
          aria-label="Settings menu"
          title="Settings"
        >
          <svg viewBox="0 0 16 16" fill="currentColor" className="h-4 w-4" aria-hidden="true">
            <circle cx="3" cy="8" r="1.4" />
            <circle cx="8" cy="8" r="1.4" />
            <circle cx="13" cy="8" r="1.4" />
          </svg>
        </button>

        {open && (
          <div className="absolute right-0 top-full z-30 mt-1.5 w-52 overflow-hidden rounded-(--radius-card) border border-(--border-subtle) bg-(--surface-panel) py-1 shadow-(--shadow-panel)">
            <button
              type="button"
              onClick={() => {
                setStep('send')
                setOpen(false)
              }}
              className="block w-full px-3 py-2 text-left text-sm text-(--text-primary) hover:bg-(--surface-panel-raised)"
            >
              Drone Connection
            </button>
            <button
              type="button"
              onClick={() => {
                setModal('settings')
                setOpen(false)
              }}
              className="block w-full px-3 py-2 text-left text-sm text-(--text-primary) hover:bg-(--surface-panel-raised)"
            >
              Settings
            </button>
            <button
              type="button"
              onClick={() => {
                setModal('cloud-sync')
                setOpen(false)
              }}
              className="flex w-full items-center justify-between px-3 py-2 text-left text-sm text-(--text-secondary) hover:bg-(--surface-panel-raised)"
            >
              Cloud Sync
              <span className="rounded-full bg-(--surface-panel-raised) px-1.5 py-0.5 text-[10px] text-(--text-muted)">Soon</span>
            </button>
          </div>
        )}
      </div>

      {modal === 'settings' && <SettingsModal onClose={() => setModal(null)} />}
      {modal === 'cloud-sync' && <CloudSyncModal onClose={() => setModal(null)} />}
    </>
  )
}

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="w-full max-w-sm overflow-hidden rounded-(--radius-card) bg-(--surface-panel) shadow-(--shadow-panel)" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-(--border-subtle) px-4 py-3">
          <h2 className="text-sm font-semibold text-(--text-primary)">{title}</h2>
          <button type="button" onClick={onClose} className="text-(--text-muted) hover:text-(--text-primary)" aria-label="Close">
            <svg viewBox="0 0 16 16" fill="none" className="h-4 w-4" aria-hidden="true">
              <path d="M3 3l10 10M13 3 3 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  )
}

function SettingsModal({ onClose }: { onClose: () => void }) {
  const [confirming, setConfirming] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [done, setDone] = useState(false)
  const reset = useFieldStore((s) => s.reset)

  const clearAllData = async () => {
    setClearing(true)
    const records = await listProjects()
    await Promise.all(records.map((r) => deleteProject(r.id)))
    setActiveProjectId(null)
    reset()
    setClearing(false)
    setDone(true)
  }

  return (
    <ModalShell title="Settings" onClose={onClose}>
      <div className="space-y-4 text-sm">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-(--text-muted)">Storage</h3>
          <p className="mt-1 text-xs text-(--text-secondary)">
            Every project is stored only in this browser (IndexedDB) — nothing leaves your machine. Clearing your
            browser's site data for FieldWise removes it the same way this button does.
          </p>
        </div>

        {done ? (
          <p className="text-xs text-success">All local projects cleared.</p>
        ) : confirming ? (
          <div className="rounded-(--radius-card) border border-danger/30 bg-danger-bg p-3">
            <p className="text-xs text-danger">
              This permanently deletes every saved project on this device. This can't be undone.
            </p>
            <div className="mt-2 flex gap-2">
              <Button size="sm" variant="danger" disabled={clearing} onClick={clearAllData}>
                {clearing ? 'Clearing…' : 'Yes, clear everything'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button size="sm" variant="secondary" onClick={() => setConfirming(true)}>
            Clear all local data
          </Button>
        )}
      </div>
    </ModalShell>
  )
}

function CloudSyncModal({ onClose }: { onClose: () => void }) {
  return (
    <ModalShell title="Cloud Sync" onClose={onClose}>
      <p className="text-sm text-(--text-secondary)">
        Not available yet. FieldWise works fully offline by design today — every plan, correction, and export runs
        entirely in this browser, on purpose, so it keeps working with no signal in the field. Cloud sync (backing up
        and sharing projects across devices) is planned for a future release, not this one.
      </p>
      <p className="mt-3 text-xs text-(--text-muted)">
        In the meantime, use Export to share a project as a file (GeoJSON, KML, or the printable handoff sheet).
      </p>
    </ModalShell>
  )
}
