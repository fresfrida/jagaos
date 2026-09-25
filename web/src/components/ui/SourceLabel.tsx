import { FileSignature, FileText, Mail, MessageSquare, Receipt, ScrollText } from 'lucide-react'
import type { ReactNode } from 'react'
import type { SourceKind } from '../../features/memories/types'

const ICONS: Record<SourceKind, ReactNode> = {
  'meeting-notes': <ScrollText size={12} />,
  'contract-pdf': <FileSignature size={12} />,
  'email-thread': <Mail size={12} />,
  'invoice-pdf': <Receipt size={12} />,
  'chat-message': <MessageSquare size={12} />,
  document: <FileText size={12} />,
}

/** Small monospace source reference, e.g. "Contract PDF". */
export function SourceLabel({ kind, label }: { kind: SourceKind; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-line bg-white px-2 py-0.5 font-mono text-[12px] text-muted">
      <span aria-hidden="true">{ICONS[kind]}</span>
      {label}
    </span>
  )
}
