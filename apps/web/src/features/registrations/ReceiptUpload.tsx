import type { RegistrationDto } from '@foodboll/contracts';
import { useRef, useState } from 'react';
import { useApiMutation } from '../../api/queries';
import { useI18n } from '../../i18n/I18nProvider';
import { Alert } from '../../ui/Alert';
import { Button } from '../../ui/Button';
import { ErrorState } from '../../ui/ErrorState';
import { Upload } from '../../ui/icons';
import { useToast } from '../../ui/Toast';

const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPTED = ['image/jpeg', 'image/png', 'application/pdf'];

/** Fallback when automatic confirmation does not happen: an admin checks the receipt by hand. */
export function ReceiptUpload({ registrationId }: { readonly registrationId: string }) {
  const { t } = useI18n();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [localError, setLocalError] = useState<'PAYLOAD_TOO_LARGE' | 'INVALID_RECEIPT' | null>(
    null,
  );
  const upload = useApiMutation<File, RegistrationDto>(
    (file) => ({ path: `/v1/registrations/${registrationId}/receipt`, method: 'PUT', file }),
    [['registration', registrationId], ['registrations']],
  );

  const onPick = (file: File | undefined) => {
    setLocalError(null);
    if (!file) return;
    if (!ACCEPTED.includes(file.type)) return setLocalError('INVALID_RECEIPT');
    if (file.size > MAX_BYTES) return setLocalError('PAYLOAD_TOO_LARGE');
    upload.mutate(file, { onSuccess: () => toast.show(t('registration.uploaded')) });
    if (input.current) input.current.value = '';
  };

  return (
    <section className="card card--pad stack">
      <div>
        <h2>{t('payment.receiptTitle')}</h2>
        <p className="muted small">{t('payment.receiptHint')}</p>
      </div>
      <input
        ref={input}
        type="file"
        accept={ACCEPTED.join(',')}
        className="visually-hidden"
        tabIndex={-1}
        aria-hidden="true"
        data-testid="receipt-input"
        onChange={(event) => onPick(event.target.files?.[0])}
      />
      <Button loading={upload.isPending} onClick={() => input.current?.click()}>
        <Upload size={18} aria-hidden="true" />
        {t('payment.uploadReceipt')}
      </Button>
      <p className="small muted">
        {t('registration.receiptHint', { maxMb: MAX_BYTES / 1024 / 1024 })}
      </p>
      {localError && <Alert>{t(`errors.${localError}`)}</Alert>}
      {upload.isError && <ErrorState error={upload.error} />}
    </section>
  );
}
