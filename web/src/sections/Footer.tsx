import { Container } from '../components/ui/Container'
import { Logo } from '../components/ui/Logo'
import { PRODUCT_NAME } from '../config/product'
import { FOOTER_TAGLINE } from '../config/site'

/** The signed-out footer: the logo, one line about what the product is, and the
 * copyright. Round 16 (item 1) took out everything else it used to carry — four
 * columns of links (most of them plain-text placeholders that went nowhere) and
 * two social icons — because none of it pointed at anything real. */
export function Footer() {
  return (
    <footer className="border-t border-line py-8 sm:py-10">
      <Container>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Logo />
            <p className="mt-3 max-w-[26rem] text-sm leading-6 text-muted">{FOOTER_TAGLINE}</p>
          </div>
          <p className="text-[14px] text-muted">
            &copy; {new Date().getFullYear()} {PRODUCT_NAME}. All rights reserved.
          </p>
        </div>
      </Container>
    </footer>
  )
}
