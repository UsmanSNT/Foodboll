import {
  LEGAL_DOCUMENT_LABEL_KEY,
  LEGAL_DOCUMENT_TYPES,
  type LegalDocumentDto,
  type LegalDocumentType,
} from '@foodboll/contracts';
import { LOCALES } from '@foodboll/i18n';
import { Navigate, useParams } from 'react-router-dom';
import { Breadcrumb } from '../components/Breadcrumb';
import { ErrorMessage } from '../components/ErrorMessage';
import { LocalizedText } from '../components/LocalizedText';
import { useApiResource } from '../hooks/useApiResource';
import { useI18n } from '../i18n/I18nProvider';

const isLegalType = (value: string | undefined): value is LegalDocumentType =>
  (LEGAL_DOCUMENT_TYPES as readonly string[]).includes(value ?? '');

export function LegalPage() {
  const { type } = useParams();
  if (!isLegalType(type)) return <Navigate to="/me" replace />;
  return <LegalDocument type={type} />;
}

function LegalDocument({ type }: { readonly type: LegalDocumentType }) {
  const { t } = useI18n();
  const resource = useApiResource<LegalDocumentDto>(`/v1/legal/${type}`);
  return (
    <section>
      <Breadcrumb
        trail={[
          { to: '/me', label: t('myPage.title') },
          { label: t(LEGAL_DOCUMENT_LABEL_KEY[type]) },
        ]}
      />
      {resource.status === 'loading' && <p>{t('common.loading')}</p>}
      {resource.status === 'error' && (
        <ErrorMessage error={resource.error} onRetry={resource.reload} />
      )}
      {resource.status === 'success' && (
        <article>
          <h1>
            <LocalizedText value={resource.data.title} />
          </h1>
          {/* Plain text only: documents are never rendered as HTML. */}
          <p className="prewrap">
            <span lang={LOCALES[resource.data.body.locale].intlTag}>{resource.data.body.text}</span>
          </p>
        </article>
      )}
    </section>
  );
}
