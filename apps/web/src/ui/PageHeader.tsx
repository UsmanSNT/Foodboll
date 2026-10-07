import type { ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useI18n } from '../i18n/I18nProvider';
import { Button } from './Button';
import { ArrowLeft } from './icons';

/** Sticky top bar. `back` shows a back arrow that returns to the previous screen. */
export function PageHeader({
  title,
  back,
  actions,
  plain,
  onBack,
}: {
  readonly title: string;
  readonly back?: boolean;
  /** Replaces the default "go to the previous screen", e.g. to confirm discarding unsaved work. */
  readonly onBack?: () => void;
  readonly actions?: ReactNode;
  /** The page has its own `<h1>` (e.g. a match title): the bar's text must not be a second one. */
  readonly plain?: boolean;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  // A shared deep link has no in-app entry before it: go home instead of doing nothing.
  const goBack = () =>
    location.key === 'default' ? void navigate('/', { replace: true }) : void navigate(-1);
  return (
    <header className="page-header">
      {back && (
        <Button variant="ghost" icon aria-label={t('common.back')} onClick={onBack ?? goBack}>
          <ArrowLeft size={22} aria-hidden="true" />
        </Button>
      )}
      {plain ? (
        <span className="page-header__title">{title}</span>
      ) : (
        <h1 className="page-header__title">{title}</h1>
      )}
      {actions}
    </header>
  );
}
