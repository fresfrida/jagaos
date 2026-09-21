import { AnimatePresence, motion } from 'framer-motion'
import { Search, SearchX, SlidersHorizontal } from 'lucide-react'
import { useId, useMemo, useState } from 'react'
import { EmptyState } from '../../components/ui/EmptyState'
import { MemoryCard } from '../../components/ui/MemoryCard'
import { MEMORIES, TAGS } from '../memories/mockData'
import { filterMemories } from '../memories/memoryMatching'
import type { TagId } from '../memories/types'
import { TagSidebar } from './TagSidebar'

export function TagsPreview() {
  const [tag, setTag] = useState<TagId | null>(null)
  const [query, setQuery] = useState('')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const inputId = useId()
  const drawerId = useId()

  const visible = useMemo(() => filterMemories(MEMORIES, { tag, query }), [tag, query])
  const activeLabel = TAGS.find((t) => t.id === tag)?.label ?? 'All'

  return (
    <div className="p-4 sm:p-6">
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_200px] sm:gap-6 lg:grid-cols-[minmax(0,1fr)_240px]">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <label htmlFor={inputId} className="sr-only">
              Search memories
            </label>
            <div className="flex h-11 min-w-0 flex-1 items-center gap-2.5 rounded-control border border-line bg-white px-3 transition-colors focus-within:border-ink">
              <Search size={16} className="shrink-0 text-muted" aria-hidden="true" />
              <input
                id={inputId}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search memories"
                autoComplete="off"
                className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted [&::-webkit-search-cancel-button]:hidden"
              />
            </div>
            <button
              type="button"
              onClick={() => setDrawerOpen((open) => !open)}
              aria-expanded={drawerOpen}
              aria-controls={drawerId}
              className="flex h-11 shrink-0 cursor-pointer items-center gap-2 rounded-control border border-line bg-white px-3 text-sm hover:border-ink/40 sm:hidden"
            >
              <SlidersHorizontal size={15} aria-hidden="true" />
              {activeLabel}
            </button>
          </div>

          <div id={drawerId} className="sm:hidden">
            <AnimatePresence initial={false}>
              {drawerOpen && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.3 }}
                  className="overflow-hidden"
                >
                  <TagSidebar
                    tags={TAGS}
                    memories={MEMORIES}
                    active={tag}
                    onChange={(next) => {
                      setTag(next)
                      setDrawerOpen(false)
                    }}
                    className="mt-3 rounded-card border border-line bg-canvas p-2"
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <p className="mb-3 mt-4 font-mono text-[11px] text-muted" aria-live="polite">
            {visible.length} {visible.length === 1 ? 'memory' : 'memories'} · {activeLabel} · sample data
          </p>

          {visible.length === 0 ? (
            <div className="rounded-card border border-line">
              <EmptyState icon={<SearchX size={22} />} title="No memories match" description="Clear the search or choose another tag." />
            </div>
          ) : (
            <ul className="space-y-2.5">
              <AnimatePresence initial={false} mode="popLayout">
                {visible.map((memory) => (
                  <motion.li
                    key={memory.id}
                    layout
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.3 }}
                  >
                    <MemoryCard memory={memory} />
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          )}
        </div>

        <div className="hidden sm:block">
          <p className="mb-2 px-3 font-mono text-[11px] uppercase tracking-wide text-muted">Tags</p>
          <TagSidebar tags={TAGS} memories={MEMORIES} active={tag} onChange={setTag} />
        </div>
      </div>
    </div>
  )
}
