import { useEffect } from 'react'
import { CalendarHub } from '../features/calendar/CalendarHub'
import { useAuth } from '../features/auth/AuthContext'
import { RequireSession } from '../features/auth/RequireSession'
import { navigate } from '../router/navigate'
import { routeHref, type ResolvedRoute } from '../router/routes'
import { WelcomeHero } from '../sections/WelcomeHero'
import { HowItWorks } from '../sections/HowItWorks'
import { StackList } from '../sections/StackList'
import { CompanyFilesPage } from './CompanyFilesPage'
import { CompanySettingsPage } from './CompanySettingsPage'
import { FramePage } from './FramePage'
import { LoginPage } from './LoginPage'
import { NotFoundPage } from './NotFoundPage'
import { OnlyMePage } from './OnlyMePage'
import { SearchPage } from './SearchPage'
import { SignedInHome } from './SignedInHome'
import { UploadPage } from './UploadPage'

/** /ops is superseded by /upload (2026-09-23, header/nav restructure) —
 * kept as a redirect rather than a 404 since it's the one URL every
 * existing bookmark/phone-home-screen shortcut points at. */
function OpsRedirect() {
  useEffect(() => navigate(routeHref('upload')), [])
  return null
}

/** Maps a route to its page. Pages compose features; they hold no logic of their own. */
export function Page({ route }: { route: ResolvedRoute }) {
  const { status, role } = useAuth()

  switch (route) {
    case 'home':
      // Signed in: the hub (SignedInHome); a viewer, who cannot upload, gets the Only me page here instead.
      // Both are a direct render at `/`, never a redirect. Signed out: the landing page.
      if (status !== 'signed-in') return <WelcomeHero />
      return role === 'viewer' ? (
        <FramePage route="only-me">
          <OnlyMePage />
        </FramePage>
      ) : (
        <SignedInHome />
      )
    case 'calendar':
      // A session is required, like every other app page (DECISIONS #106). It used to show a sample-data preview to
      // everyone else; that preview, and the Tags page, are gone.
      return (
        <FramePage route="calendar">
          <RequireSession>
            <CalendarHub />
          </RequireSession>
        </FramePage>
      )
    case 'how-it-works':
      return (
        <FramePage route="how-it-works">
          <HowItWorks />
        </FramePage>
      )
    case 'stack':
      return (
        <FramePage route="stack">
          <StackList />
        </FramePage>
      )
    case 'login':
      return <LoginPage />
    case 'ops':
      return <OpsRedirect />
    case 'upload':
      return (
        <FramePage route="upload">
          <UploadPage />
        </FramePage>
      )
    case 'company-files':
      return (
        <FramePage route="company-files">
          <CompanyFilesPage />
        </FramePage>
      )
    case 'search':
      return (
        <FramePage route="search">
          <SearchPage />
        </FramePage>
      )
    case 'company-settings':
      return (
        <FramePage route="company-settings">
          <CompanySettingsPage />
        </FramePage>
      )
    case 'only-me':
      return (
        <FramePage route="only-me">
          <OnlyMePage />
        </FramePage>
      )
    case 'not-found':
      return <NotFoundPage />
  }
}
