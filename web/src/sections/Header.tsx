import { Container } from '../components/ui/Container'
import { Logo } from '../components/ui/Logo'
import { PreviewLink } from '../features/preview/PreviewLink'
import type { PreviewMode } from '../features/preview/types'
import { useScrolled } from '../hooks/useScrolled'
import { cn } from '../lib/cn'

export function Header({ onOpenPreview }: { onOpenPreview: (mode: PreviewMode) => void }) {
  const scrolled = useScrolled()

  return (
    <header
      className={cn(
        'sticky top-0 z-40 border-b transition-colors duration-300',
        scrolled ? 'border-line bg-white/80 backdrop-blur-md' : 'border-transparent bg-white',
      )}
    >
      <Container className="flex h-16 items-center justify-between">
        <Logo />
        <div className="flex items-center gap-1.5 sm:gap-2">
          {/* Placeholder target until there is a real sign-in page. */}
          <a href="#get-started" className="rounded-md px-3 py-2 text-sm font-medium text-ink">
            Log In
          </a>
          <PreviewLink mode="calendar" onOpen={onOpenPreview} size="sm" label="Get Started" showIcon={false} />
        </div>
      </Container>
    </header>
  )
}
