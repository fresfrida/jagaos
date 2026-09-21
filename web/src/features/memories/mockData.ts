import type { Memory, Tag } from './types'

export const TAGS: Tag[] = [
  { id: 'finance', label: 'Finance' },
  { id: 'customers', label: 'Customers' },
  { id: 'operations', label: 'Operations' },
  { id: 'decisions', label: 'Decisions' },
  { id: 'invoices', label: 'Invoices' },
]

export const MEMORIES: Memory[] = [
  {
    id: 'm-acme-renewal',
    text: 'The team approved the Acme renewal with a 12-month term.',
    tags: ['customers', 'decisions'],
    sources: [
      { kind: 'meeting-notes', label: 'Meeting notes' },
      { kind: 'contract-pdf', label: 'Contract PDF' },
      { kind: 'email-thread', label: 'Email thread' },
    ],
    date: '2026-09-17',
  },
  {
    id: 'm-acme-billing',
    text: 'Acme asked for quarterly billing. Finance will confirm before the renewal is countersigned.',
    tags: ['customers', 'finance'],
    sources: [{ kind: 'email-thread', label: 'Email thread' }],
    date: '2026-09-18',
  },
  {
    id: 'm-payroll-cutoff',
    text: 'Payroll cut-off moves to the 25th from October, giving finance two working days for checks.',
    tags: ['finance', 'operations', 'decisions'],
    sources: [{ kind: 'email-thread', label: 'Email thread' }],
    date: '2026-09-15',
  },
  {
    id: 'm-northwind-invoice',
    text: 'Invoice INV-2041 from Northwind Packaging for $4,280.00 is due 30 Sep and was approved by finance.',
    tags: ['invoices', 'finance'],
    sources: [{ kind: 'invoice-pdf', label: 'Invoice PDF' }],
    date: '2026-09-12',
  },
  {
    id: 'm-supplier-review',
    text: 'Northwind agreed to hold unit prices until March in exchange for a six-month volume commitment.',
    tags: ['operations', 'decisions'],
    sources: [
      { kind: 'meeting-notes', label: 'Meeting notes' },
      { kind: 'email-thread', label: 'Email thread' },
    ],
    date: '2026-09-10',
  },
  {
    id: 'm-warehouse-handover',
    text: 'The warehouse handover checklist now requires a signed stock count before keys are released.',
    tags: ['operations'],
    sources: [
      { kind: 'document', label: 'Handover checklist' },
      { kind: 'chat-message', label: 'Chat message' },
    ],
    date: '2026-09-08',
  },
  {
    id: 'm-harbour-dispute',
    text: 'Invoice INV-2037 from Harbour Logistics is on hold while a duplicate freight charge is disputed.',
    tags: ['invoices', 'operations'],
    sources: [
      { kind: 'email-thread', label: 'Email thread' },
      { kind: 'invoice-pdf', label: 'Invoice PDF' },
    ],
    date: '2026-09-05',
  },
  {
    id: 'm-brightside-onboarding',
    text: 'Onboarding for Brightside Dental moved to the first week of October after their site survey.',
    tags: ['customers', 'operations'],
    sources: [{ kind: 'chat-message', label: 'Chat message' }],
    date: '2026-09-14',
  },
  {
    id: 'm-monthly-close',
    text: 'Monthly close is complete once bank reconciliation and accrual review are signed off by the finance lead.',
    tags: ['finance', 'decisions'],
    sources: [{ kind: 'meeting-notes', label: 'Meeting notes' }],
    date: '2026-08-31',
  },
]
