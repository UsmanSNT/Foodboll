import { LEGAL_DOCUMENT_LABEL_KEY, type LegalDocumentType } from '@foodboll/contracts';
import { useI18n } from '../../../../i18n/I18nProvider';
import { ButtonLink } from '../../../../ui/Button';
import { EmptyState } from '../../../../ui/EmptyState';
import { ErrorState } from '../../../../ui/ErrorState';
import { ShieldCheck } from '../../../../ui/icons';
import { ListSkeleton } from '../../../../ui/Skeleton';
import { usePublishedLegal } from '../api';
import { SettingsFrame } from '../SettingsFrame';
import { LegalForm } from './LegalForm';
import { parseLegalType } from './legal-form';

function LoadedLegalEditor({ type }: { readonly type: LegalDocumentType }) {
  const { t } = useI18n();
  const query = usePublishedLegal(type);
  const title = t(LEGAL_DOCUMENT_LABEL_KEY[type]);

  // Without the published texts the form would drop every language it could not show, so it waits.
  if (query.isError) {
    return (
      <SettingsFrame title={title}>
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </SettingsFrame>
    );
  }
  if (query.isPending) {
    return (
      <SettingsFrame title={title}>
        <ListSkeleton rows={2} height={200} />
      </SettingsFrame>
    );
  }
  return <LegalForm type={type} published={query.data} />;
}

/** The editor for `/admin/legal/:type`; an unknown type is a not-found page, not an empty form. */
export function LegalEditor({ rawType }: { readonly rawType: string }) {
  const { t } = useI18n();
  const type = parseLegalType(rawType);

  if (type === null) {
    return (
      <SettingsFrame title={t('adminSettings.legal.title')}>
        <EmptyState
          icon={<ShieldCheck size={32} />}
          title={t('errors.NOT_FOUND')}
          action={<ButtonLink to="/admin/legal">{t('adminSettings.legal.backToList')}</ButtonLink>}
        />
      </SettingsFrame>
    );
  }
  // One editor per document: moving to another type must not carry over what was typed.
  return <LoadedLegalEditor key={type} type={type} />;
}
