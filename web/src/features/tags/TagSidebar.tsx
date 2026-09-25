import { cn } from '../../lib/cn'
import type { Memory, Tag, TagId } from '../memories/types'
import { countByTag } from '../memories/memoryMatching'

interface TagSidebarProps {
  tags: Tag[]
  memories: Memory[]
  active: TagId | null
  onChange: (tag: TagId | null) => void
  className?: string
}

/** The tag filter list. Rendered as a persistent sidebar (sm+) and inside the mobile drawer. */
export function TagSidebar({ tags, memories, active, onChange, className }: TagSidebarProps) {
  const items: Array<{ id: TagId | null; label: string; count: number }> = [
    { id: null, label: 'All', count: memories.length },
    ...tags.map((t) => ({ id: t.id, label: t.label, count: countByTag(memories, t.id) })),
  ]
  return (
    <nav aria-label="Filter by tag" className={className}>
      <ul className="space-y-0.5">
        {items.map((item) => {
          const selected = item.id === active
          return (
            <li key={item.label}>
              <button
                type="button"
                onClick={() => onChange(item.id)}
                aria-pressed={selected}
                className={cn(
                  'flex min-h-10 w-full cursor-pointer items-center justify-between rounded-control px-3 text-left text-sm transition-colors duration-200',
                  selected ? 'bg-ink text-white' : 'text-ink hover:bg-canvas',
                )}
              >
                {item.label}
                <span className={cn('font-mono text-[12px]', selected ? 'text-white/70' : 'text-muted')}>{item.count}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
