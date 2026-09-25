import { useState } from 'react'

/** False until `value` has been true once, then true for the life of the component, even if `value` goes false again.
 * Derived during render (no effect), so it is true in the same render that `value` first is: there is no frame in between.
 * App.tsx uses it so the footer is revealed by the FIRST page that settles and is not hidden again by later ones (DECISIONS #112). */
export function useLatch(value: boolean): boolean {
  const [latched, setLatched] = useState(value)
  if (value && !latched) setLatched(true)
  return latched || value
}
