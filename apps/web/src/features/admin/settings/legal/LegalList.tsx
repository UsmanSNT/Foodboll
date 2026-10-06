import {
  LEGAL_DOCUMENT_LABEL_KEY,
  LEGAL_DOCUMENT_TYPES,
  type LegalDocumentType,
} from '@foodboll/contracts';
import { Link } from 'react-router-dom';
import { useI18n } from '../../../../i18n/I18nProvider';
import { Badge } from '../../../../ui/Badge';
import { ErrorState } from '../../../../ui/ErrorState';
import { ChevronRight, ShieldCheck } from '../../../../ui/icons';
import { Skeleton } from '../../../../ui/Skeleton';
import { useLegalStatus } from '../api';
import { SettingsFrame } from '../SettingsFrame';

function LegalRow({ type }: { readonly type: LegalDocumentType }) {
  const { t, formatDateLong } = useI18n();
  const status = useLegalStatus(type);
  const doc = status.data;

  return (
    <li>
      <Link to={`/admin/legal/${type}`} className="list__item">
        <ShieldCheck size={18} aria-hidden="true" />
        <div className="grow as-doc">
          <strong>{t(LEGAL_DOCUMENT_LABEL_KEY[type])}</strong>
          {status.isPending && <Skeleton height={14} width={150} />}
          {status.isError && (
            <span className="small muted">{t('adminSettings.legal.statusUnknown')}</span>
          )}
          {doc === null && <span className="small muted">{t('adminSettings.legal.none')}</span>}
          {doc && (
            <span className="small muted">
              {t('adminSettings.legal.version', {
                version: doc.version,
                date: formatDateLong(doc.publishedAt),
              })}
            </span>
          )}
        </div>
        {doc === null && <Badge tone="warning">{t('adminSettings.legal.notPublished')}</Badge>}
        {doc && <Badge tone="success">{t('adminSettings.legal.published')}</Badge>}
        <ChevronRight size={16} aria-hidden="true" />
      </Link>
      {status.isError && (
        <div className="as-doc__error">
          <ErrorState error={status.error} onRetry={() => void status.refetch()} />
        </div>
      )}
    </li>
  );
}

/** The four documents, each with whether a version is published, and a way into its editor. */
export function LegalList() {
  const { t } = useI18n();
  return (
    <SettingsFrame title={t('adminSettings.legal.title')}>
      <p className="small muted">{t('adminSettings.legal.intro')}</p>
      <ul className="card list as-docs">
        {LEGAL_DOCUMENT_TYPES.map((type) => (
          <LegalRow key={type} type={type} />
        ))}
      </ul>
    </SettingsFrame>
  );
}
