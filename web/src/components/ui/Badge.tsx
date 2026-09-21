import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

interface BadgeProps {
  tone?: 'neutral' | 'sage'
  mono?: boolean
  children: ReactNode
  className?: string
}

export function Badge({ tone = 'neutral', mono = false, children, className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-2 py-0.5 text-[11px] leading-5',
        mono && 'font-mono uppercase tracking-wide',
        tone === 'sage' ? 'bg-sage/15 text-sage-ink' : 'bg-canvas text-muted border border-line',
        className,
      )}
    >
      {children}
    </span>
  )
}
