import { useEffect } from 'react'
import { CalendarHub } from '../features/calendar/CalendarHub'
import { CalendarPreview } from '../features/calendar/CalendarPreview'
import { useAuth } from '../features/auth/AuthContext'
import { ProductFrame } from '../features/preview/ProductFrame'
import { TagsLanding } from '../features/tags/TagsLanding'
import { TagsPreview } from '../features/tags/TagsPreview'
import { navigate } from '../router/navigate'
import { routeHref, type ResolvedRoute } from '../router/routes'
import { WelcomeHero } from '../sections/WelcomeHero'
import { HowItWorks } from '../sections/HowItWorks'
import { StackList } from '../sections/StackList'
import { CompanyFilesPage } from './CompanyFilesPage'
import { CompanySettingsPage } from './CompanySettingsPage'
import { FramePage } from './FramePage'
import { GetStartedPage } from './GetStartedPage'
import { LoginPage } from './LoginPage'
import { NotFoundPage } from './NotFoundPage'
import { OnlyMePage } from './OnlyMePage'
import { SearchPage } from './SearchPage'
import { UploadPage } from './UploadPage'

/** /ops is superseded by /upload (2026-09-23, header/nav restructure) —
 * kept as a redirect rather than a 404 since it's the one URL every
 * existing bookmark/phone-home-screen shortcut points at. */
function OpsRedirect() {
  useEffect(() => navigate(routeHref('upload')), [])
  return null
}

/** Same bare mount-effect pattern as OpsRedirect above (2026-09-23,
 * role/permission work) — a signed-in visitor to / used to see the
 * marketing hero (Hero.tsx, now deleted) instead of the app, a confirmed
 * gap: `home` never branched on session status the way `calendar`/`tags`
 * already did. Redirects into Calendar, the real signed-in hub. */
function HomeRedirect() {
  useEffect(() => navigate(routeHref('calendar')), [])
  return null
}

/** Maps a route to its page. Pages compose features; they hold no logic of their own. */
export function Page({ route }: { route: ResolvedRoute }) {
  const { status } = useAuth()

  switch (route) {
    case 'home':
      return status === 'signed-in' ? <HomeRedirect /> : <WelcomeHero />
    case 'calendar':
      // Same URL for everyone (2026-09-23, header/nav restructure) — a
      // signed-in visitor gets the real Calendar hub (dates/obligations/
      // gap analysis); everyone else keeps seeing the existing mock-data
      // marketing preview, unchanged.
      return (
        <FramePage route="calendar">
          {status === 'signed-in' ? (
            <CalendarHub />
          ) : (
            <ProductFrame>
              <CalendarPreview />
            </ProductFrame>
          )}
        </FramePage>
      )
    case 'tags':
      return (
        <FramePage route="tags">
          {status === 'signed-in' ? (
            <TagsLanding />
          ) : (
            <ProductFrame>
              <TagsPreview />
            </ProductFrame>
          )}
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
    case 'get-started':
      return <GetStartedPage />
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
