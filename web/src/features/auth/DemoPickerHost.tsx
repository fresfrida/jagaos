/** The one demo-account picker (2026-09-25, DECISIONS #106), opened by every "Get Started" / "Pick a demo role" button through
 * lib/demoPickerTrigger.ts. App mounts it only while nobody is signed in, so its open state cannot outlive a sign-in and
 * reopen after a log out. */

import { useEffect, useState } from 'react'
import { onOpenDemoPicker } from '../../lib/demoPickerTrigger'
import { DemoPicker } from './DemoPicker'

export function DemoPickerHost() {
  const [open, setOpen] = useState(false)
  useEffect(() => onOpenDemoPicker(() => setOpen(true)), [])
  return <DemoPicker open={open} onClose={() => setOpen(false)} />
}
