import type { AnchorHTMLAttributes, MouseEvent } from 'react'
import { navigate } from './navigate'

/** An <a> that navigates without a page reload. Modified clicks (new tab, etc.) and external links stay native. */
export function Link({ href, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event)
    const modified = event.metaKey || event.ctrlKey || event.shiftKey || event.altKey
    if (event.defaultPrevented || event.button !== 0 || modified || !href?.startsWith('/')) return
    event.preventDefault()
    navigate(href)
  }
  return <a href={href} onClick={handleClick} {...rest} />
}
