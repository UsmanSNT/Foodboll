import { useI18n } from '../../../i18n/I18nProvider';

/**
 * The bank message exactly as received, as plain text. It holds personal data (names, partial
 * account numbers), so it is only ever rendered here, for admins, and never logged.
 */
export function RawMessage({ text }: { readonly text: string }) {
  const { t } = useI18n();
  return (
    <figure className="money-raw">
      <figcaption className="small muted">{t('adminDeposits.rawLabel')}</figcaption>
      <pre lang="ko">{text}</pre>
    </figure>
  );
}
