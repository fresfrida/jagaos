import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

/** The one place the 1240px content width and side gutters are set — the
 * header and every page compose it, so a change here moves them all together.
 * Gutters (round 14): 20px on a phone, 32px from 640px, 40px from 1024px, so
 * nothing touches the screen edge (they were 16/24/32). */
export function Container({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('mx-auto w-full max-w-[1240px] px-5 sm:px-8 lg:px-10', className)}>{children}</div>
}
