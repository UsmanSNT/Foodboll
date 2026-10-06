import {
  LEGAL_DOCUMENT_LABEL_KEY,
  LEGAL_DOCUMENT_TYPES,
  type LegalDocumentType,
} from '@foodboll/contracts';
import { LOCALES } from '@foodboll/i18n';
import { Link, useParams } from 'react-router-dom';
import { useLegalDocument } from '../../api/queries';
import { useI18n } from '../../i18n/I18nProvider';
import { EmptyState } from '../../ui/EmptyState';
import { ErrorState } from '../../ui/ErrorState';
import { ChevronRight, ShieldCheck } from '../../ui/icons';
import { PageHeader } from '../../ui/PageHeader';
import { ListSkeleton } from '../../ui/Skeleton';
import { ApiError } from '../../api/client';

const isLegalType = (value: string): value is LegalDocumentType =>
  (LEGAL_DOCUMENT_TYPES as readonly string[]).includes(value);

export function LegalIndexPage() {
  const { t } = useI18n();
  return (
    <>
      <PageHeader back title={t('myPage.legal')} />
      <div className="page">
        <ul className="card list">
          {LEGAL_DOCUMENT_TYPES.map((type) => (
            <li key={type}>
              <Link to={`/legal/${type.toLowerCase()}`} className="list__item">
                <ShieldCheck size={18} aria-hidden="true" />
                <span className="grow">{t(LEGAL_DOCUMENT_LABEL_KEY[type])}</span>
                <ChevronRight size={16} aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

function LegalDocument({ type }: { readonly type: LegalDocumentType }) {
  const { t } = useI18n();
  const doc = useLegalDocument(type);
  if (doc.isPending) return <ListSkeleton rows={2} height={180} />;
  if (doc.isError) {
    const missing = doc.error instanceof ApiError && doc.error.code === 'LEGAL_DOCUMENT_NOT_FOUND';
    return missing ? (
      <EmptyState icon={<ShieldCheck size={32} />} title={t('legal.notAvailable')} />
    ) : (
      <ErrorState error={doc.error} onRetry={() => void doc.refetch()} />
    );
  }
  const { title, body } = doc.data;
  return (
    <article className="card card--pad stack">
      <h1 lang={title.locale}>{title.text}</h1>
      <p className="prewrap" lang={body.locale}>
        {body.text}
      </p>
      {body.isFallback && (
        <p className="small muted">
          {t('content.fallbackNotice', { language: LOCALES[body.locale].nativeName })}
        </p>
      )}
    </article>
  );
}

export function LegalPage() {
  const { t } = useI18n();
  const { type = '' } = useParams();
  const upper = type.toUpperCase();
  return (
    <>
      <PageHeader
        back
        title={isLegalType(upper) ? t(LEGAL_DOCUMENT_LABEL_KEY[upper]) : t('myPage.legal')}
      />
      <div className="page">
        {isLegalType(upper) ? (
          <LegalDocument type={upper} />
        ) : (
          <EmptyState icon={<ShieldCheck size={32} />} title={t('legal.notAvailable')} />
        )}
      </div>
    </>
  );
}
