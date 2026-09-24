/** A number that changes when the ACTIVE COMPANY changes from one company to
 * another (2026-09-24, round 12, DECISIONS #77) — used as part of a React key
 * so the routed page remounts and refetches for the new company.
 *
 * Deliberately not just `company.id` in the key: the id goes null -> 1 on
 * every ordinary page load (the session check resolves after first render),
 * which would remount the page a second time for everyone, switcher or not.
 * This only counts a change between two real ids. */

import { useState } from 'react'

export function useCompanyScopeKey(companyId: number | undefined): number {
  const [scope, setScope] = useState<{ id: number | undefined; generation: number }>({ id: companyId, generation: 0 })
  if (companyId !== undefined && companyId !== scope.id) {
    // Derived state adjusted during render (React's documented pattern),
    // not an effect — an effect would paint the old company's page first.
    setScope({ id: companyId, generation: scope.id === undefined ? scope.generation : scope.generation + 1 })
  }
  return scope.generation
}
