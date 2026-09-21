export type TagId = 'finance' | 'customers' | 'operations' | 'decisions' | 'invoices'

export interface Tag {
  id: TagId
  label: string
}

export type SourceKind = 'meeting-notes' | 'contract-pdf' | 'email-thread' | 'invoice-pdf' | 'chat-message' | 'document'

export interface SourceRef {
  kind: SourceKind
  label: string
}

/** A single remembered fact with its provenance. Mirrors a document + tags + citation, in view-model form. */
export interface Memory {
  id: string
  text: string
  tags: TagId[]
  sources: SourceRef[]
  /** ISO date `YYYY-MM-DD`. */
  date: string
}
