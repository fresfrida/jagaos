/** No em dashes in anything a user reads (2026-09-24, round 14, DECISIONS #87).
 * Banned project-wide: use a comma, a period or a reworded sentence.
 *
 * Two checks, both mechanical so the ban does not depend on remembering it:
 *  1. every string value in the four locale files;
 *  2. every string literal, template piece and JSX text in the app's source
 *     (found with the TypeScript compiler, so a comment is never mistaken for
 *     copy and a real string is never missed) — this covers aria-label/title/alt
 *     values, toast and error text, and the page title.
 *
 * Deliberately NOT checked: code comments and docstrings, which this codebase
 * writes with em dashes as a convention, and test files. If a hit is really
 * a comment, this test has a bug; if it is a string, reword the string. */

import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import en from './locales/en.json'
import ms from './locales/ms.json'
import ta from './locales/ta.json'
import zh from './locales/zh.json'

const EM_DASH = '—'

function stringsIn(value: unknown, path = ''): Array<[string, string]> {
  if (typeof value === 'string') return [[path, value]]
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, child]) => stringsIn(child, path ? `${path}.${key}` : key))
  }
  return []
}

describe('locale files', () => {
  for (const [name, locale] of Object.entries({ en, zh, ms, ta })) {
    it(`${name}.json has no em dash in any string`, () => {
      const hits = stringsIn(locale).filter(([, text]) => text.includes(EM_DASH)).map(([key]) => key)
      expect(hits).toEqual([])
    })
  }
})

// Vite loads every non-test source file as raw text; nothing here touches the filesystem.
const sources = import.meta.glob(['./**/*.ts', './**/*.tsx', '!./**/*.test.ts', '!./**/*.test.tsx'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

function literalHits(file: string, text: string): string[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const hits: string[] = []
  const visit = (node: ts.Node) => {
    const literal =
      ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) || ts.isTemplateTail(node) || ts.isJsxText(node)
    if (literal && node.text.includes(EM_DASH)) {
      const { line } = sf.getLineAndCharacterOfPosition(node.getStart())
      hits.push(`${file}:${line + 1}: ${JSON.stringify(node.text.trim().slice(0, 80))}`)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return hits
}

describe('source string literals', () => {
  it('finds source files to check (guards the glob itself)', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(50)
  })

  it('contain no em dash', () => {
    const hits = Object.entries(sources).flatMap(([file, text]) => (text.includes(EM_DASH) ? literalHits(file, text) : []))
    expect(hits).toEqual([])
  })
})
