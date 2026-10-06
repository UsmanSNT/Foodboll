import { Link } from 'react-router-dom';
import { useMyProfile } from '../../api/queries';
import { useAuth } from '../../auth/AuthProvider';
import { useLoginGate } from '../../auth/useRequireLogin';
import { useI18n } from '../../i18n/I18nProvider';
import { Button } from '../../ui/Button';
import { ErrorState } from '../../ui/ErrorState';
import { Calendar, ChevronRight, LogOut, Settings, ShieldCheck } from '../../ui/icons';
import { LogoMark } from '../../ui/Logo';
import { PageHeader } from '../../ui/PageHeader';
import { ListSkeleton } from '../../ui/Skeleton';
import { ProfileView } from '../players/ProfileView';
import { LanguageSwitch } from './LanguageSwitch';
import { RoleLinks } from './RoleLinks';

function MenuLink({ to, icon, label }: { readonly to: string; readonly icon: React.ReactNode; readonly label: string }) {
  return (
    <li>
      <Link to={to} className="list__item">
        <span aria-hidden="true">{icon}</span>
        <span className="grow">{label}</span>
        <ChevronRight size={16} aria-hidden="true" />
      </Link>
    </li>
  );
}

export function MePage() {
  const { t } = useI18n();
  const { signedIn, signOut } = useAuth();
  const { openLogin } = useLoginGate();
  const profile = useMyProfile();

  if (!signedIn) {
    return (
      <>
        <PageHeader title={t('nav.myPage')} />
        <div className="page">
          <section className="card card--pad stack signed-out">
            <LogoMark size={56} />
            <h1>{t('auth.title')}</h1>
            <p className="muted">{t('auth.subtitle')}</p>
            <Button variant="primary" size="lg" block onClick={openLogin}>
              {t('auth.login')}
            </Button>
          </section>
          <section className="stack">
            <h2 className="section-title">{t('language.title')}</h2>
            <LanguageSwitch />
          </section>
          <ul className="card list">
            <MenuLink to="/legal" icon={<ShieldCheck size={18} />} label={t('myPage.legal')} />
          </ul>
        </div>
      </>
    );
  }

  const menu = (
    <>
      <ul className="card list">
        <MenuLink to="/my-matches" icon={<Calendar size={18} />} label={t('nav.myMatches')} />
        <MenuLink to="/settings" icon={<Settings size={18} />} label={t('myPage.settings')} />
        <MenuLink to="/legal" icon={<ShieldCheck size={18} />} label={t('myPage.legal')} />
      </ul>
      <RoleLinks />
      <Button variant="ghost" block onClick={() => void signOut()}>
        <LogOut size={18} aria-hidden="true" />
        {t('auth.logout')}
      </Button>
    </>
  );

  return (
    <>
      <PageHeader title={t('nav.myPage')} />
      {profile.isPending && (
        <div className="page">
          <ListSkeleton rows={3} height={140} />
        </div>
      )}
      {profile.isError && (
        <div className="page">
          <ErrorState error={profile.error} onRetry={() => void profile.refetch()} />
          {menu}
        </div>
      )}
      {profile.isSuccess && <ProfileView profile={profile.data} extra={<div className="stack">{menu}</div>} />}
    </>
  );
}
