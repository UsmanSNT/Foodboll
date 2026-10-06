import type { AdminPaymentInstructionDto, PaymentInstructionInput } from '@foodboll/contracts';
import { LOCALE_CODES, LOCALES, type LocaleCode } from '@foodboll/i18n';
import { useState } from 'react';
import { useI18n } from '../../../../i18n/I18nProvider';
import { Alert } from '../../../../ui/Alert';
import { Button } from '../../../../ui/Button';
import { ErrorState } from '../../../../ui/ErrorState';
import { Segmented } from '../../../../ui/Segmented';
import { Sheet } from '../../../../ui/Sheet';
import { PaymentCard } from './PaymentCard';
import { playerView } from './payment-form';

const LANGUAGE_OPTIONS = LOCALE_CODES.map((code) => ({
  value: code,
  label: LOCALES[code].nativeName,
}));

interface PaymentPreviewSheetProps {
  /** What is about to be saved; null while the sheet is closed. */
  readonly input: PaymentInstructionInput | null;
  /** What players see now, to point out a changed account. */
  readonly current: AdminPaymentInstructionDto | null;
  readonly startLanguage: LocaleCode;
  readonly saving: boolean;
  readonly error: unknown;
  readonly onConfirm: () => void;
  readonly onClose: () => void;
}

/**
 * The last look before real money starts going to this account: the card exactly as players will
 * see it, in any language, with the changes to the account itself called out.
 */
export function PaymentPreviewSheet({
  input,
  current,
  startLanguage,
  saving,
  error,
  onConfirm,
  onClose,
}: PaymentPreviewSheetProps) {
  const { t } = useI18n();
  return (
    <Sheet open={input !== null} title={t('adminSettings.payment.preview.title')} onClose={onClose}>
      {input && (
        <Preview
          input={input}
          current={current}
          startLanguage={startLanguage}
          saving={saving}
          error={error}
          onConfirm={onConfirm}
          onClose={onClose}
        />
      )}
    </Sheet>
  );
}

function Preview({
  input,
  current,
  startLanguage,
  saving,
  error,
  onConfirm,
  onClose,
}: PaymentPreviewSheetProps & { readonly input: PaymentInstructionInput }) {
  const { t } = useI18n();
  const [language, setLanguage] = useState(startLanguage);
  const view = playerView(input, language);

  return (
    <div className="stack">
      <p className="muted">{t('adminSettings.payment.preview.intro')}</p>
      <div className="as-segmented">
        <Segmented
          value={language}
          options={LANGUAGE_OPTIONS}
          onChange={setLanguage}
          label={t('adminSettings.payment.preview.language')}
        />
      </div>
      {view && <PaymentCard view={view} />}
      {view?.bankName.isFallback && (
        <p className="small muted">
          {t('adminSettings.payment.preview.fallback', { language: LOCALES[language].nativeName })}
        </p>
      )}
      {current && current.accountNumber !== input.accountNumber && (
        <Alert tone="info">
          {t('adminSettings.payment.preview.accountChanged', {
            from: current.accountNumber,
            to: input.accountNumber,
          })}
        </Alert>
      )}
      {current && current.accountHolder !== input.accountHolder && (
        <Alert tone="info">
          {t('adminSettings.payment.preview.holderChanged', {
            from: current.accountHolder,
            to: input.accountHolder,
          })}
        </Alert>
      )}
      <Alert tone="warning">{t('adminSettings.payment.preview.warning')}</Alert>
      <p className="small muted">{t('adminSettings.payment.preview.effect')}</p>
      {error !== null && error !== undefined && <ErrorState error={error} />}
      <Button variant="primary" block loading={saving} onClick={onConfirm}>
        {t('adminSettings.payment.preview.submit')}
      </Button>
      <Button block disabled={saving} onClick={onClose}>
        {t('adminSettings.keepEditing')}
      </Button>
    </div>
  );
}
