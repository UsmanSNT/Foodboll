import {
  LEGAL_DOCUMENT_LABEL_KEY,
  type LegalDocumentInput,
  type LegalDocumentType,
} from '@foodboll/contracts';
import { LOCALE_CODES, LOCALES } from '@foodboll/i18n';
import { useI18n } from '../../../../i18n/I18nProvider';
import { Badge } from '../../../../ui/Badge';
import { Button } from '../../../../ui/Button';
import { ErrorState } from '../../../../ui/ErrorState';
import { AlertTriangle } from '../../../../ui/icons';
import { Sheet } from '../../../../ui/Sheet';
import type { PublishedLegal } from '../api';
import { outcomeOf } from './legal-form';

interface PublishSheetProps {
  readonly type: LegalDocumentType;
  /** What is about to be published; null while the sheet is closed. */
  readonly input: LegalDocumentInput | null;
  /** The version readers have now, if any. */
  readonly published: PublishedLegal | null;
  readonly publishing: boolean;
  readonly error: unknown;
  readonly onConfirm: () => void;
  readonly onClose: () => void;
}

/** Publishing is permanent and immediate, so it says exactly what changes for readers of each language. */
export function PublishSheet({
  type,
  input,
  published,
  publishing,
  error,
  onConfirm,
  onClose,
}: PublishSheetProps) {
  const { t } = useI18n();
  const documentName = t(LEGAL_DOCUMENT_LABEL_KEY[type]);

  return (
    <Sheet open={input !== null} title={t('adminSettings.legal.confirm.title')} onClose={onClose}>
      {input && (
        <div className="stack">
          <p>
            {published
              ? t('adminSettings.legal.confirm.next', {
                  document: documentName,
                  version: published.version,
                })
              : t('adminSettings.legal.confirm.first', { document: documentName })}
          </p>
          <section className="stack" aria-labelledby="as-outcomes-title">
            <h3 id="as-outcomes-title" className="section-title">
              {t('adminSettings.legal.confirm.languages')}
            </h3>
            <ul className="card list">
              {LOCALE_CODES.map((code) => {
                const outcome = outcomeOf(code, input, published);
                const written = input.translations[code];
                return (
                  <li key={code} className="as-outcome">
                    <div className="row row--between">
                      <strong lang={code}>{LOCALES[code].nativeName}</strong>
                      <Badge
                        tone={
                          outcome === 'written'
                            ? 'success'
                            : outcome === 'removed'
                              ? 'warning'
                              : 'neutral'
                        }
                      >
                        {t(
                          outcome === 'written'
                            ? 'adminSettings.lang.filled'
                            : 'adminSettings.lang.empty',
                        )}
                      </Badge>
                    </div>
                    {written && (
                      <p className="small muted as-outcome__title" lang={code}>
                        {written.title}
                      </p>
                    )}
                    {outcome === 'fallback' && (
                      <p className="small muted">
                        {t('adminSettings.legal.confirm.emptyFallback')}
                      </p>
                    )}
                    {outcome === 'removed' && (
                      <p className="small as-outcome__removed">
                        <AlertTriangle size={16} aria-hidden="true" />
                        <span>{t('adminSettings.legal.confirm.removed')}</span>
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
          {error !== null && error !== undefined && <ErrorState error={error} />}
          <Button variant="primary" block loading={publishing} onClick={onConfirm}>
            {t('adminSettings.legal.confirm.submit')}
          </Button>
          <Button block disabled={publishing} onClick={onClose}>
            {t('adminSettings.keepEditing')}
          </Button>
        </div>
      )}
    </Sheet>
  );
}
