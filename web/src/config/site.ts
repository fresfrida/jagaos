import { PRODUCT_NAME } from './product'

import type { PreviewMode } from '../features/preview/types'

/** The two hero/CTA links. Each is a real link (#calendar, #tags) to a frame of the product preview. */
export const PREVIEW_LINKS: Record<PreviewMode, { label: string; href: string }> = {
  calendar: { label: 'View Calendar', href: '#calendar' },
  tags: { label: 'View Tags', href: '#tags' },
}

export const HERO = {
  pill: 'New: AI memory for growing teams',
  headingLead: 'Build a reliable company memory',
  headingSoft: 'at scale',
  copy: 'Capture the knowledge scattered across your business and retrieve it whenever your team needs it.',
  searchPlaceholder: 'Ask what your company already knows...',
} as const

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
  { name: 'AWS Lightsail', description: 'One instance in Singapore serves the site and the API.', responsibility: 'Host' },
  { name: 'Magic-link sign-in', description: 'Passwordless email links, revocable sessions and role checks.', responsibility: 'Identity' },
  { name: 'SQLite', description: 'One database file per instance, scoped by organisation.', responsibility: 'Data' },
  { name: 'Local file storage', description: 'Original documents stored by content hash, outside the web root.', responsibility: 'Files' },
  { name: 'SQLite FTS5', description: 'Full-text search over extracted text, with cited passages.', responsibility: 'Search' },
  { name: 'AWS Bedrock: Claude Sonnet 4.5', description: 'Reads documents and proposes fields, tags and dates.', responsibility: 'Extract', highlight: true },
  { name: 'Jev via langchain-typesafe', description: 'Scores each proposed field and flags uncertain ones for review.', responsibility: 'Validate', highlight: true },
]

export const FINAL_CTA = {
  heading: 'Give your team a memory that stays useful.',
  copy: 'Start organising your company knowledge without adding another administrative burden.',
} as const

export interface FooterColumn {
  title: string
  links: string[]
}

export const FOOTER_COLUMNS: FooterColumn[] = [
  { title: 'Product', links: ['Search', 'Calendar', 'Tags', 'Security'] },
  { title: 'Solutions', links: ['Operations', 'Finance', 'Customer Success', 'Founders'] },
  { title: 'Resources', links: ['Documentation', 'API', 'Guides', 'Status'] },
  { title: 'Company', links: ['About', 'Contact', 'Privacy', 'Terms'] },
]

export const FOOTER_TAGLINE = `${PRODUCT_NAME} helps small teams keep what they know.`
