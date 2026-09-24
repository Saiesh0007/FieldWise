import clsx from 'clsx'

interface SpinnerProps {
  size?: 'sm' | 'md'
  className?: string
}

/** A small inline spinner for async in-progress states (connecting, uploading) — paired with the existing text label, not a replacement for it, so the state is legible even to a screenshot with the animation paused. */
export function Spinner({ size = 'sm', className }: SpinnerProps) {
  return (
    <svg
      className={clsx('animate-spin', size === 'sm' ? 'h-3.5 w-3.5' : 'h-5 w-5', className)}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-90" fill="currentColor" d="M12 2a10 10 0 0 1 10 10h-4a6 6 0 0 0-6-6V2z" />
    </svg>
  )
}
