import { STACK_ROWS } from '../config/site'
import { cn } from '../lib/cn'

/** Horizontal rows: technology, what it does, and a right-aligned responsibility label. */
export function StackList() {
  return (
    <ul className="border-t border-line">
      {STACK_ROWS.map((row) => (
        <li
          key={row.name}
          className="flex flex-col gap-1 border-b border-line py-5 transition-colors duration-200 hover:bg-canvas sm:grid sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_7rem] sm:items-baseline sm:gap-6 sm:px-3"
        >
          <div className="flex items-baseline justify-between gap-3 sm:contents">
            <p className="text-[15px] font-medium text-ink">{row.name}</p>
            <span className={cn('font-mono text-xs uppercase tracking-wide sm:order-last sm:text-right', row.highlight ? 'text-sage-ink' : 'text-muted')}>
              {row.responsibility}
            </span>
          </div>
          <p className="text-sm leading-6 text-muted">{row.description}</p>
        </li>
      ))}
    </ul>
  )
}
