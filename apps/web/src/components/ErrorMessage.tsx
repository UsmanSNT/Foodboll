import { hasMessage } from '@foodboll/i18n';
import type { ApiError } from '../api/client';
import { useI18n } from '../i18n/I18nProvider';

/** Localizes from the stable error code in the client's own catalog, not from server text. */
export function ErrorMessage({
  error,
  onRetry,
}: {
  readonly error: ApiError;
  readonly onRetry?: () => void;
}) {
  const { t } = useI18n();
  const key = `errors.${error.code}`;
  return (
    <div role="alert" className="error">
      <p>{hasMessage(key) ? t(key) : t('errors.INTERNAL_ERROR')}</p>
      {onRetry && (
        <button type="button" onClick={onRetry}>
          {t('common.retry')}
        </button>
      )}
    </div>
  );
}
