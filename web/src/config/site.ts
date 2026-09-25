export const HOW_IT_WORKS = [
  { number: '01', title: 'Capture', body: 'Connect documents, messages and operational records.' },
  { number: '02', title: 'Organise', body: 'Extract structured information and apply permissions and tags.' },
  { number: '03', title: 'Recall', body: 'Ask questions and receive answers grounded in original sources.' },
] as const

export interface StackRow {
  name: string
  description: string
  responsibility: string
  /** Only selected responsibilities carry the muted green. */
  highlight?: boolean
}

/** Hosted services outside Lightsail + Bedrock are deliberately absent (GAPS.md §5). */
export const STACK_ROWS: StackRow[] = [
  { name: 'Vite + React + TypeScript', description: 'A typed front end, built to static files.', responsibility: 'App' },
  { name: 'AWS Lightsail', description: 'One instance in Singapore serves the API.', responsibility: 'Host' },
  { name: 'Session-based auth', description: 'Hashed session tokens, revocable, with role checks per company.', responsibility: 'Identity' },
  { name: 'SQLite', description: 'One database file per instance, scoped by organisation.', responsibility: 'Data' },
  { name: 'Local file storage', description: 'Original documents stored by content hash, outside the web root.', responsibility: 'Files' },
  { name: 'SQLite FTS5', description: 'Full-text search across filenames, descriptions and extracted text.', responsibility: 'Search' },
  { name: 'AWS Bedrock: Claude Sonnet 4.5', description: 'Reads documents and proposes fields, buckets and dates.', responsibility: 'Extract', highlight: true },
  // 2026-09-24 (item 10): "GST arithmetic checks" was stale after the tax
  // check became locality-aware (Singapore's 9% rate no longer applies
  // unconditionally to every invoice) — "tax arithmetic" describes what
  // it actually does now, not one specific country's rate.
  { name: 'Deterministic verification', description: 'Confidence floor and tax arithmetic checks (code, not a model call) flag anything uncertain for human review.', responsibility: 'Validate', highlight: true },
]

/** The legal entity in the footer's copyright line, verbatim (DECISIONS #106): the company, not the product name. */
export const LEGAL_ENTITY = 'Platform R PCIB Pte Ltd'
export const COPYRIGHT_YEAR = 2026

/** The footer's bottom row, in order. PLACEHOLDERS: `#` until the real destinations exist (they are needed before the submission,
 * KANBAN). Each id is a key under `footer.links.*`.
 *
 * All three open in a NEW TAB (Footer.tsx sets `target="_blank" rel="noopener noreferrer"` on every link, DECISIONS #118), so the
 * landing page is never navigated away from; and a link that is still `#` goes nowhere at all (its click is swallowed there).
 * Shipping a destination is ONLY the `href` here, no JSX and no behaviour change:
 *   - video: the YouTube URL, an external site (for example 'https://youtu.be/...');
 *   - proposal and techWriteUp: a PDF dropped into `web/public/`, which is served from the site root exactly as the icons are
 *     (Vercel and the Caddyfile's catch-all both do), then the href is its path (for example '/jagaos-proposal.pdf'). */
export const FOOTER_LINKS = [
  { id: 'video', href: '#' },
  { id: 'proposal', href: '#' },
  { id: 'techWriteUp', href: '#' },
] as const
