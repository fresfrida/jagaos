/** The confirmation an owner sees before a business profile is laid over the
 * Company Settings form (2026-09-24, round 16, item 6): every field the profile
 * would change, with what it holds now and what the profile would put there. It
 * replaces applying straight away and leaving the owner to spot the highlighted
 * fields. Presentational: the changes come computed (companyForm.prefillChanges) and
 * the caller decides what "apply" and "cancel" do. Applying fills the FORM; nothing
 * is saved until the owner presses Save on the form as before. */

import { useTranslation } from 'react-i18next'
import { BottomSheet } from '../../components/ui/BottomSheet'
import { Button } from '../../components/ui/Button'
import type { CompanyForm, CompanyFormField, PrefillChange } from './companyForm'

const FIELD_LABEL_KEYS: Record<CompanyFormField, string> = {
  name: 'companySettings.nameLabel',
  uen: 'companySettings.uenLabel',
  fyeMonth: 'companySettings.fyeMonthLabel',
  fyeDay: 'companySettings.fyeDayLabel',
  gstRegistered: 'companySettings.gstLabel',
  registeredAddress: 'companySettings.addressLabel',
}

export function PrefillConfirmSheet({
  open,
  changes,
  onApply,
  onCancel,
}: {
  open: boolean
  changes: PrefillChange[]
  onApply: () => void
  onCancel: () => void
}) {
  const { t } = useTranslation()

  const show = (value: CompanyForm[CompanyFormField]): string => {
    if (typeof value === 'boolean') return value ? t('ops.review.boolean.yes') : t('ops.review.boolean.no')
    return String(value).trim() === '' ? t('companySettings.prefill.empty') : String(value)
  }

  return (
    <BottomSheet open={open} onClose={onCancel} title={t('companySettings.prefill.confirmTitle')}>
      {changes.length === 0 ? (
        <>
          <p className="text-[14px] text-ink">{t('companySettings.prefill.noChanges')}</p>
          <div className="mt-4 flex justify-end">
            <Button size="sm" variant="secondary" onClick={onCancel}>{t('common.buttons.close')}</Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-[14px] text-muted">{t('companySettings.prefill.confirmIntro')}</p>
          <ul className="mt-3 max-h-[50vh] divide-y divide-line overflow-y-auto rounded-card border border-line" data-testid="prefill-changes">
            {changes.map((change) => (
              <li key={change.field} className="px-3 py-2.5 text-[14px]">
                <p className="font-medium text-ink">{t(FIELD_LABEL_KEYS[change.field])}</p>
                <dl className="mt-1 grid grid-cols-[4.5rem_1fr] gap-x-3 gap-y-0.5">
                  <dt className="text-muted">{t('companySettings.prefill.now')}</dt>
                  <dd className="min-w-0 break-words text-muted line-through decoration-muted/50">{show(change.before)}</dd>
                  <dt className="text-muted">{t('companySettings.prefill.fromProfile')}</dt>
                  <dd className="min-w-0 break-words font-medium text-ink">{show(change.after)}</dd>
                </dl>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[13px] text-muted">{t('companySettings.prefill.saveNote')}</p>
          <div className="mt-4 flex justify-end gap-2">
            <Button size="sm" variant="secondary" onClick={onCancel}>{t('common.buttons.cancel')}</Button>
            <Button size="sm" onClick={onApply}>{t('companySettings.prefill.apply')}</Button>
          </div>
        </>
      )}
    </BottomSheet>
  )
}
