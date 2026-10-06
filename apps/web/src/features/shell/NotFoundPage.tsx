import { useI18n } from '../../i18n/I18nProvider';
import { ButtonLink } from '../../ui/Button';
import { EmptyState } from '../../ui/EmptyState';
import { Home } from '../../ui/icons';
import { PageHeader } from '../../ui/PageHeader';

export function NotFoundPage() {
  const { t } = useI18n();
  return (
    <>
      <PageHeader back title={t('app.name')} />
      <div className="page">
        <EmptyState
          icon={<Home size={32} />}
          title={t('errors.NOT_FOUND')}
          action={<ButtonLink to="/">{t('nav.matches')}</ButtonLink>}
        />
      </div>
    </>
  );
}
