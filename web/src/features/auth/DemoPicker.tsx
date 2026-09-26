/** The demo-account picker (2026-09-25, round 20, item 1): a sheet listing the four
 * seeded demo accounts with what each role can do, opened by the home page's demo button.
 * Choosing a row signs in as that account through the ordinary login (useDemoLogin). It
 * replaces the button that always signed in as the owner, so a visitor can see the app as
 * a viewer or a user, not only as the one account with every permission.
 *
 * Presentational apart from the login hook: the roster is config/demo.ts, the words are
 * in the locale files, and the sheet is the shared BottomSheet. */

import { Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { BottomSheet } from '../../components/ui/BottomSheet'
import { DEMO_ACCOUNTS } from '../../config/demo'
import { roleLabel } from '../ops/opsShared'
import { useDemoLogin } from './useDemoLogin'

export function DemoPicker({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const demo = useDemoLogin()

  return (
    <BottomSheet open={open} onClose={onClose} title={t('home.demo.pickerTitle')}>
      <p className="text-[14px] leading-5 text-muted">{t('home.demo.pickerIntro')}</p>
      <ul className="mt-3 max-h-[60vh] divide-y divide-line overflow-y-auto border-y border-line">
        {DEMO_ACCOUNTS.map((account) => {
          const working = demo.signingInAs === account.email
          return (
            <li key={account.id}>
              <button
                type="button"
                disabled={demo.busy}
                onClick={() => void demo.start(account.email)}
                className="flex w-full items-start gap-3 px-1 py-3 text-left transition-colors hover:bg-canvas focus-visible:bg-canvas focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent"
              >
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-[16px] font-semibold text-ink">{t(`home.demo.accounts.${account.id}.name`)}</span>
                    {/* Each row is a named person, so the role is always shown: it is what the visitor is choosing. */}
                    <span className="font-mono text-[12px] uppercase tracking-wide text-muted">{roleLabel(t, account.role)}</span>
                  </span>
                  <span className="mt-0.5 block text-[14px] leading-5 text-muted">{t(`home.demo.accounts.${account.id}.text`)}</span>
                  <span className="mt-0.5 block break-all font-mono text-[12px] text-muted">{account.email}</span>
                </span>
                {working && <Loader2 size={16} className="mt-1 shrink-0 animate-spin text-muted" aria-label={t('home.demo.opening')} />}
              </button>
            </li>
          )
        })}
      </ul>
      {demo.failed && (
        <p role="alert" className="mt-3 text-[14px] text-red-700">{t('home.demo.failed')}</p>
      )}
    </BottomSheet>
  )
}
