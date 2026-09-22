import { PRODUCT_NAME } from './product'

import type { RouteId } from '../router/routes'

/** Labels of the two hero / Get Started buttons. Each links to its own page (/calendar, /tags). */
export const CTA_LABELS = { calendar: 'Calendar in Time', tags: 'Relevant Tags' } as const

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
  { name: 'AWS Lightsail', description: 'One instance in Singapore serves the API.', responsibility: 'Host' },
  { name: 'Session-based auth', description: 'Hashed session tokens, revocable, with role checks per company.', responsibility: 'Identity' },
  { name: 'SQLite', description: 'One database file per instance, scoped by organisation.', responsibility: 'Data' },
  { name: 'Local file storage', description: 'Original documents stored by content hash, outside the web root.', responsibility: 'Files' },
  { name: 'SQLite FTS5', description: 'Full-text search across filenames, descriptions and extracted text.', responsibility: 'Search' },
  { name: 'AWS Bedrock: Claude Sonnet 4.5', description: 'Reads documents and proposes fields, buckets and dates.', responsibility: 'Extract', highlight: true },
  { name: 'Deterministic verification', description: 'Confidence floor and GST arithmetic checks — code, not a model call — flag anything uncertain for human review.', responsibility: 'Validate', highlight: true },
]

export const FINAL_CTA = {
  heading: 'Give your team a memory that stays useful.',
  copy: 'Start organising your company knowledge without adding another administrative burden.',
} as const

export interface FooterLink {
  label: string
  /** Links without a route are placeholders until those pages exist. */
  route?: RouteId
}

export interface FooterColumn {
  title: string
  links: FooterLink[]
}

export const FOOTER_COLUMNS: FooterColumn[] = [
  {
    title: 'Product',
    links: [{ label: 'Search', route: 'home' }, { label: 'Calendar', route: 'calendar' }, { label: 'Tags', route: 'tags' }, { label: 'Security', route: 'stack' }],
  },
  { title: 'Solutions', links: ['Operations', 'Finance', 'Customer Success', 'Founders'].map((label) => ({ label })) },
  {
    title: 'Resources',
    links: [{ label: 'Documentation' }, { label: 'API' }, { label: 'Guides', route: 'how-it-works' }, { label: 'Status' }],
  },
  { title: 'Company', links: ['About', 'Contact', 'Privacy', 'Terms'].map((label) => ({ label })) },
]

export const FOOTER_TAGLINE = `${PRODUCT_NAME} helps small teams keep what they know.`
