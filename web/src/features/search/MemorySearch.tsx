import { AnimatePresence, motion } from 'framer-motion'
import { ArrowRight, Loader2, Search, SearchX, X } from 'lucide-react'
import { useId, useState, type FormEvent } from 'react'
import { HERO } from '../../config/site'
import { PRODUCT_NAME } from '../../config/product'
import { EmptyState } from '../../components/ui/EmptyState'
import { MemoryCard } from '../../components/ui/MemoryCard'
import { useMemorySearch } from './useMemorySearch'

export function MemorySearch() {
  const [value, setValue] = useState('')
  const { state, run, clear } = useMemorySearch()
  const inputId = useId()
  const resultsId = useId()

  const submit = (event: FormEvent) => {
    event.preventDefault()
    void run(value)
  }

  return (
    <div className="mx-auto w-full max-w-2xl">
      <form role="search" onSubmit={submit} aria-label={`Search ${PRODUCT_NAME} memory`}>
        <label htmlFor={inputId} className="sr-only">
          Ask what your company already knows
        </label>
        <div className="flex h-14 items-center gap-3 rounded-card border border-line bg-white pl-4 pr-2 shadow-[0_1px_2px_rgba(20,20,20,0.04)] transition-colors focus-within:border-ink">
          <Search size={18} className="shrink-0 text-muted" aria-hidden="true" />
          <input
            id={inputId}
            type="search"
            value={value}
            onChange={(e) => {
              setValue(e.target.value)
              if (!e.target.value.trim()) clear()
            }}
            placeholder={HERO.searchPlaceholder}
            autoComplete="off"
            className="h-full min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-[14px] placeholder:text-muted sm:placeholder:text-base [&::-webkit-search-cancel-button]:hidden"
          />
          {value && (
            <button
              type="button"
              onClick={() => {
                setValue('')
                clear()
              }}
              aria-label="Clear search"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted hover:text-ink"
            >
              <X size={16} />
            </button>
          )}
          <button
            type="submit"
            aria-label="Search"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-ink text-white transition-colors hover:bg-black"
          >
            <ArrowRight size={16} />
          </button>
        </div>
      </form>

      <div id={resultsId} aria-live="polite" className="text-left">
        <AnimatePresence initial={false} mode="wait">
          {state.status !== 'idle' && (
            <motion.div
              key={state.status}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="mt-3"
            >
              {state.status === 'loading' && (
                <p className="flex items-center justify-center gap-2 py-4 text-sm text-muted">
                  <Loader2 size={14} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
                  Searching memory for “{state.query}”…
                </p>
              )}
              {state.status === 'error' && <p className="py-4 text-center text-sm text-ink" role="alert">{state.message}</p>}
              {state.status === 'done' && state.result.matches.length === 0 && (
                <div className="rounded-card border border-line bg-white">
                  <EmptyState
                    icon={<SearchX size={22} />}
                    title="Nothing in memory matches that yet"
                    description="Try a customer, supplier or invoice number. This preview searches sample data."
                  />
                </div>
              )}
              {state.status === 'done' && state.result.matches.length > 0 && (
                <div className="space-y-2.5">
                  <p className="font-mono text-[12px] uppercase tracking-wide text-muted">
                    {state.result.matches.length} grounded {state.result.matches.length === 1 ? 'answer' : 'answers'} · sample data
                  </p>
                  {state.result.matches.map((memory) => (
                    <MemoryCard key={memory.id} memory={memory} compact />
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
