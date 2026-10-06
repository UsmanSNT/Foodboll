import { hasMessage } from '@foodboll/i18n';
import { ApiError } from '../api/client';
import { useI18n } from '../i18n/I18nProvider';
import { Alert } from './Alert';
import { Button } from './Button';

/** Localizes from the stable error code in the client's own catalog, not from server text. */
export function ErrorState({ error, onRetry }: { readonly error: unknown; readonly onRetry?: () => void }) {
  const { t } = useI18n();
  const code = error instanceof ApiError ? error.code : 'INTERNAL_ERROR';
  const key = `errors.${code}`;
  return (
    <div className="stack">
      <Alert>{hasMessage(key) ? t(key) : t('errors.INTERNAL_ERROR')}</Alert>
      {onRetry && (
        <Button size="sm" onClick={onRetry}>
          {t('common.retry')}
        </Button>
      )}
    </div>
  );
}
