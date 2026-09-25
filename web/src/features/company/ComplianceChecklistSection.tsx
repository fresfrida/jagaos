/** The compliance checklist as a section of Company Settings (round 21, A2, DECISIONS #101): loads what the checklist
 * needs, shows the loading and failed states, and hands the rest to the presentational ComplianceChecklist. Company
 * Settings is owner and admin only, so everyone who can see this can also upload the document a missing row asks for. */

import { useTranslation } from 'react-i18next'
import { Button } from '../../components/ui/Button'
import { ComplianceChecklist } from './ComplianceChecklist'
import { useComplianceChecklist } from './useComplianceChecklist'

export function ComplianceChecklistSection({ enabled }: { enabled: boolean }) {
  const { t } = useTranslation()
  const { state, retry } = useComplianceChecklist(enabled)

  if (state.status === 'loading') {
    return <p className="text-[14px] text-muted" role="status">{t('companySettings.checklist.loading')}</p>
  }
  if (state.status === 'failed') {
    return (
      <div className="rounded-card border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
        <p>{t('companySettings.checklist.loadFailed')}</p>
        <Button size="sm" variant="secondary" className="mt-2" onClick={retry}>{t('common.buttons.retry')}</Button>
      </div>
    )
  }
  return <ComplianceChecklist expectations={state.expectations} documents={state.documents} canUpload />
}
