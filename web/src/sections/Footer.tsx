import { Container } from '../components/ui/Container'
import { Logo } from '../components/ui/Logo'
import { PRODUCT_NAME } from '../config/product'
import { FOOTER_COLUMNS, FOOTER_TAGLINE } from '../config/site'
import { Link } from '../router/Link'
import { routeHref } from '../router/routes'

const socialClass = 'flex h-9 w-9 items-center justify-center rounded-control border border-line text-muted transition-colors hover:border-ink/40 hover:text-ink'

function LinkedInIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
      <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.03-3.04-1.85-3.04-1.86 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13zM7.12 20.45H3.56V9h3.56v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0z" />
    </svg>
  )
}

function XIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true">
      <path d="M18.9 1.15h3.68l-8.04 9.19L24 22.85h-7.4l-5.8-7.58-6.63 7.58H.49l8.6-9.83L0 1.15h7.59l5.24 6.93 6.07-6.93zm-1.29 19.5h2.04L6.48 3.24H4.3l13.31 17.41z" />
    </svg>
  )
}

export function Footer() {
  return (
    <footer className="border-t border-line py-12 sm:py-16">
      <Container>
        <div className="grid gap-10 lg:grid-cols-[1.2fr_repeat(4,1fr)]">
          <div className="col-span-2 lg:col-span-1">
            <Logo />
            <p className="mt-4 max-w-[16rem] text-sm leading-6 text-muted">{FOOTER_TAGLINE}</p>
          </div>
          <div className="col-span-2 grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-4 lg:col-span-4">
            {FOOTER_COLUMNS.map((column) => (
              <nav key={column.title} aria-label={column.title}>
                <h2 className="font-sans text-sm font-medium tracking-normal text-ink">{column.title}</h2>
                <ul className="mt-4 space-y-3">
                  {column.links.map(({ label, route }) => (
                    <li key={label}>
                      {route ? (
                        <Link href={routeHref(route)} className="text-sm text-muted transition-colors hover:text-ink">
                          {label}
                        </Link>
                      ) : (
                        <span className="text-sm text-muted">{label}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </nav>
            ))}
          </div>
        </div>

        <div className="mt-12 flex flex-col-reverse items-start justify-between gap-4 border-t border-line pt-6 sm:flex-row sm:items-center">
          <p className="text-[13px] text-muted">
            © {new Date().getFullYear()} {PRODUCT_NAME}. All rights reserved.
          </p>
          <div className="flex gap-2">
            <a href="https://www.linkedin.com" aria-label="LinkedIn" className={socialClass} rel="noreferrer">
              <LinkedInIcon />
            </a>
            <a href="https://x.com" aria-label="X" className={socialClass} rel="noreferrer">
              <XIcon />
            </a>
          </div>
        </div>
      </Container>
    </footer>
  )
}
