import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

interface BadgeProps {
  tone?: 'neutral' | 'sage' | 'inverted'
  mono?: boolean
  children: ReactNode
  className?: string
}

export function Badge({ tone = 'neutral', mono = false, children, className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-2 py-0.5 text-[12px] leading-5',
        mono && 'font-mono uppercase tracking-wide',
        // 'inverted' (round 4, item 7, DECISIONS #122): the role pill beside the header's own avatar, now on the dark header bar —
        // the dropdown menu it also appears in stays white, so it keeps the default 'neutral' tone there.
        tone === 'sage' && 'bg-sage/15 text-sage-ink',
        tone === 'inverted' && 'border border-white/20 bg-white/10 text-white',
        tone === 'neutral' && 'border border-line bg-canvas text-muted',
        className,
      )}
    >
      {children}
    </span>
  )
}
