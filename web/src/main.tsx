import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './i18n'
import './index.css'

// /ops -> /upload (2026-09-23, header/nav restructure: /ops is superseded
// by /upload, kept only as a redirect for existing bookmarks). Rewritten
// here, before React ever mounts, rather than via a component that calls
// navigate() from its own first-mount effect: on a fresh page load,
// useRoute's popstate listener is attached by App's own effect, which (by
// React's child-effects-before-parent-effects commit order) runs AFTER a
// descendant's effect — so a navigate() call from a component's mount
// effect dispatches popstate before anything is listening, and the
// redirect silently no-ops (confirmed live: URL changes, but the route
// state and document.title both stay stuck on the old page). Rewriting
// the URL before parsePath ever sees it sidesteps that race entirely.
if (window.location.pathname.replace(/\/+$/, '') === '/ops') {
  window.history.replaceState(null, '', '/upload' + window.location.search)
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
