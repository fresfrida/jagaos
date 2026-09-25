import type { ReactNode } from 'react'

interface EmptyStateProps {
  icon: ReactNode
  title: string
  description?: string
}

export function EmptyState({ icon, title, description }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center text-muted" role="status">
      <div className="mb-3 text-muted" aria-hidden="true">{icon}</div>
      <p className="text-sm font-medium text-ink">{title}</p>
      {description && <p className="mt-1 max-w-xs text-[14px]">{description}</p>}
    </div>
  )
}
