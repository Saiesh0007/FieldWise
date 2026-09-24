import clsx from 'clsx'
import type { ButtonHTMLAttributes } from 'react'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md'
}

const VARIANT_CLASSES: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800 disabled:bg-ink-200 disabled:text-ink-400 focus-visible:ring-brand-300',
  secondary:
    'bg-(--surface-panel) text-(--text-primary) border border-(--border-subtle) hover:bg-(--surface-panel-raised) hover:border-ink-300 active:bg-ink-200 disabled:text-(--text-muted) focus-visible:ring-brand-300',
  ghost: 'text-(--text-secondary) hover:bg-(--surface-panel-raised) active:bg-ink-200 disabled:text-(--text-muted) focus-visible:ring-brand-300',
  danger: 'bg-danger-bg text-danger hover:bg-danger/20 active:bg-danger/30 disabled:text-(--text-muted) disabled:bg-transparent focus-visible:ring-danger/40',
}

const SIZE_CLASSES: Record<NonNullable<ButtonProps['size']>, string> = {
  sm: 'px-2.5 py-1.5 text-xs',
  md: 'px-3.5 py-2 text-sm',
}

export function Button({ variant = 'secondary', size = 'md', className, ...props }: ButtonProps) {
  return (
    <button
      className={clsx(
        'inline-flex items-center justify-center gap-1.5 rounded-(--radius-control) font-medium transition-all duration-150 active:scale-[0.97] disabled:cursor-not-allowed disabled:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1',
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className,
      )}
      {...props}
    />
  )
}
