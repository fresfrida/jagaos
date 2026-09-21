import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

/** The one place the 1240px content width and side gutters are set. */
export function Container({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('mx-auto w-full max-w-[1240px] px-4 sm:px-6 lg:px-8', className)}>{children}</div>
}
