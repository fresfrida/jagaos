import { AnimatePresence, motion } from 'framer-motion'
import { CalendarDays, Tag } from 'lucide-react'
import { useRef, type KeyboardEvent } from 'react'
import { PRODUCT_NAME } from '../../config/product'
import { Container } from '../../components/ui/Container'
import { cn } from '../../lib/cn'
import { CalendarPreview } from '../calendar/CalendarPreview'
import { TagsPreview } from '../tags/TagsPreview'
import type { PreviewMode } from './types'

const MODES: Array<{ id: PreviewMode; label: string; icon: typeof Tag }> = [
  { id: 'calendar', label: 'Calendar', icon: CalendarDays },
  { id: 'tags', label: 'Tags', icon: Tag },
]

interface ProductPreviewProps {
  mode: PreviewMode
  onModeChange: (mode: PreviewMode) => void
  /** Bumps every time a hero button activates the preview, to replay the highlight. */
  activationKey: number
}

export function ProductPreview({ mode, onModeChange, activationKey }: ProductPreviewProps) {
  const tabRefs = useRef<Record<PreviewMode, HTMLButtonElement | null>>({ calendar: null, tags: null })

  // Arrow keys move between tabs (WAI-ARIA tabs pattern).
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
    const next: PreviewMode = mode === 'calendar' ? 'tags' : 'calendar'
    onModeChange(next)
    tabRefs.current[next]?.focus()
  }

  return (
    <section id="product" aria-label="Product preview" className="pb-16 pt-10 sm:pb-24 sm:pt-16">
      <Container>
        <motion.div
          key={activationKey}
          initial={activationKey > 0 ? { boxShadow: '0 0 0 4px rgba(20,20,20,0.12)' } : false}
          animate={{ boxShadow: '0 0 0 0px rgba(20,20,20,0)' }}
          transition={{ duration: 0.8 }}
          className="mx-auto max-w-[1200px] overflow-hidden rounded-card border border-line bg-white"
        >
          <div className="flex items-center justify-between gap-3 border-b border-line bg-canvas px-4 py-2.5 sm:px-6">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full border border-line bg-white" aria-hidden="true" />
              <span className="h-2.5 w-2.5 rounded-full border border-line bg-white" aria-hidden="true" />
              <span className="h-2.5 w-2.5 rounded-full border border-line bg-white" aria-hidden="true" />
              <span className="ml-2 hidden font-mono text-[11px] text-muted sm:inline">{PRODUCT_NAME.toLowerCase()} / workspace</span>
            </div>
            <div role="tablist" aria-label="Preview mode" onKeyDown={onKeyDown} className="flex rounded-control border border-line bg-white p-0.5">
              {MODES.map(({ id, label, icon: Icon }) => {
                const selected = mode === id
                return (
                  <button
                    key={id}
                    ref={(el) => {
                      tabRefs.current[id] = el
                    }}
                    role="tab"
                    id={`tab-${id}`}
                    aria-selected={selected}
                    aria-controls={`panel-${id}`}
                    tabIndex={selected ? 0 : -1}
                    onClick={() => onModeChange(id)}
                    className={cn(
                      'flex h-8 cursor-pointer items-center gap-1.5 rounded-md px-3 text-[13px] font-medium transition-colors duration-200',
                      selected ? 'bg-ink text-white' : 'text-muted hover:text-ink',
                    )}
                  >
                    <Icon size={14} aria-hidden="true" />
                    {label}
                  </button>
                )
              })}
            </div>
          </div>

          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={mode}
              role="tabpanel"
              id={`panel-${mode}`}
              aria-labelledby={`tab-${mode}`}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.3 }}
            >
              {mode === 'calendar' ? <CalendarPreview /> : <TagsPreview />}
            </motion.div>
          </AnimatePresence>
        </motion.div>
      </Container>
    </section>
  )
}
