# JagaOS — web

Marketing landing page and interactive product preview (Calendar and Tags). Frontend only: all data is local mock data. No credentials needed.

Stack: Vite, React 19, TypeScript (strict), Tailwind CSS v4, Framer Motion, Lucide.

## Run locally

```bash
cd web
npm install
npm run dev        # http://localhost:5173
```

Other commands:

```bash
npm run typecheck  # tsc --noEmit
npm run build      # typecheck + production build to dist/
npm run preview    # serve dist/ on http://localhost:4173
```

## Pages

Real URL paths (History API). A static host needs an SPA fallback to `index.html`: Vite dev/preview and the Caddyfile have it, Vercel uses `vercel.json`.

| URL | Page |
|---|---|
| `/` | Landing (hero only, one viewport, no scroll) |
| `/calendar`, `/tags` | Product preview frames (header tabs) |
| `/how-it-works`, `/stack` | Content pages (linked from the footer) |
| `/get-started` | Get started (Log In placeholder target) |

Add a page: add an entry in `src/router/routes.ts` and a case in `src/pages/Page.tsx`. Link with `<Link href="/x">` (never a bare `<a>` for internal paths, it would reload the page).

## Rename the product

Edit `PRODUCT_NAME` in `src/config/product.ts`. Page copy and metadata in `index.html` / `public/manifest.webmanifest` also carry the name.

## Structure

```
src/
  config/        product name, site copy, nav, stack rows
  components/ui/ Button, Badge, Card, Container, Reveal, EmptyState, MemoryCard, ...
  features/
    memories/    types, mock data, shared matching rules
    search/      MemorySearch, useMemorySearch, searchService (mock, swap for API)
    calendar/    week grid, agenda, event details
    tags/        tag sidebar + list
    preview/     ProductFrame (window chrome)
  router/        routes, Link, navigate, useRoute, useRouteEffects
  pages/         Page (route -> page), FramePage, GetStartedPage, NotFoundPage
  sections/      Header, Hero, HowItWorks, StackList, Footer
```

Environment: copy `.env.example` to `.env` if you need `VITE_API_BASE_URL`. It is optional and unused by the mock.

See `../docs/HANDOFF.md` for architecture, decisions and next steps.
