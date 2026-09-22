import type { ReactNode } from 'react'
import { PRODUCT_NAME } from '../../config/product'

/** The bordered application window that wraps the Calendar and Tags previews. */
export function ProductFrame({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-card border border-line bg-white">
      <div className="flex items-center gap-2 border-b border-line bg-canvas px-4 py-3 sm:px-6">
        <span className="h-2.5 w-2.5 rounded-full border border-line bg-white" aria-hidden="true" />
        <span className="h-2.5 w-2.5 rounded-full border border-line bg-white" aria-hidden="true" />
        <span className="h-2.5 w-2.5 rounded-full border border-line bg-white" aria-hidden="true" />
        <span className="ml-2 font-mono text-[11px] text-muted">{PRODUCT_NAME.toLowerCase()} / workspace</span>
      </div>
      {children}
    </div>
  )
}
