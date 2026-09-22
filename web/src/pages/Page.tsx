import { CalendarPreview } from '../features/calendar/CalendarPreview'
import { OpsConsole } from '../features/ops/OpsConsole'
import { ProductFrame } from '../features/preview/ProductFrame'
import { TagsPreview } from '../features/tags/TagsPreview'
import type { ResolvedRoute } from '../router/routes'
import { Hero } from '../sections/Hero'
import { HowItWorks } from '../sections/HowItWorks'
import { StackList } from '../sections/StackList'
import { FramePage } from './FramePage'
import { GetStartedPage } from './GetStartedPage'
import { LoginPage } from './LoginPage'
import { NotFoundPage } from './NotFoundPage'

/** Maps a route to its page. Pages compose features; they hold no logic of their own. */
export function Page({ route }: { route: ResolvedRoute }) {
  switch (route) {
    case 'home':
      return <Hero />
    case 'calendar':
      return (
        <FramePage route="calendar">
          <ProductFrame>
            <CalendarPreview />
          </ProductFrame>
        </FramePage>
      )
    case 'tags':
      return (
        <FramePage route="tags">
          <ProductFrame>
            <TagsPreview />
          </ProductFrame>
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
      return (
        <FramePage route="ops">
          <OpsConsole />
        </FramePage>
      )
    case 'not-found':
      return <NotFoundPage />
  }
}
