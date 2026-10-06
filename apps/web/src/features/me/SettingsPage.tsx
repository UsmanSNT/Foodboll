import { useState } from 'react';
import { useMe, useTelegramStatus } from '../../api/queries';
import { useAuth } from '../../auth/AuthProvider';
import { useLoginGate } from '../../auth/useRequireLogin';
import { useI18n } from '../../i18n/I18nProvider';
import { regionLabel } from '../../lib/match';
import { DepositorNameForm } from '../registrations/DepositorNameForm';
import { RegionPicker } from '../../region/RegionPicker';
import { useRegion } from '../../region/RegionProvider';
import { Alert } from '../../ui/Alert';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { ChevronRight, MapPin, Send } from '../../ui/icons';
import { PageHeader } from '../../ui/PageHeader';
import { Sheet } from '../../ui/Sheet';
import { LanguageSwitch } from './LanguageSwitch';

export function SettingsPage() {
  const { t } = useI18n();
  const { signedIn } = useAuth();
  const { openLogin } = useLoginGate();
  const me = useMe();
  const telegram = useTelegramStatus();
  const { choose } = useRegion();
  const [picking, setPicking] = useState(false);

  return (
    <>
      <PageHeader back title={t('settings.title')} />
      <div className="page">
        <section className="stack">
          <h2 className="section-title">{t('language.title')}</h2>
          <LanguageSwitch />
          <p className="small muted">{t('language.description')}</p>
        </section>

        {signedIn ? (
          <>
            <section className="stack">
              <h2 className="section-title">{t('settings.region')}</h2>
              <button
                type="button"
                className="card list__item list__item--button"
                onClick={() => setPicking(true)}
              >
                <MapPin size={18} aria-hidden="true" />
                <span className="grow">
                  {me.data?.homeRegion ? regionLabel(me.data.homeRegion) : t('settings.regionNone')}
                </span>
                <ChevronRight size={16} aria-hidden="true" />
              </button>
            </section>

            <section className="stack">
              <h2 className="section-title">{t('settings.depositorName')}</h2>
              <div className="card card--pad stack">
                <DepositorNameForm />
              </div>
              <p className="small muted">{t('settings.depositorHint')}</p>
            </section>

            <section className="stack">
              <h2 className="section-title">{t('settings.telegram')}</h2>
              <div className="card card--pad stack">
                <div className="row row--between">
                  <span className="row">
                    <Send size={18} aria-hidden="true" />
                    {t('settings.telegram')}
                  </span>
                  <Badge tone={telegram.data?.notificationsEnabled ? 'success' : 'neutral'}>
                    {telegram.data?.notificationsEnabled
                      ? t('settings.telegramOn')
                      : t('settings.telegramOff')}
                  </Badge>
                </div>
                {telegram.data && !telegram.data.linked && (
                  <Alert tone="info">{t('settings.telegramLoginNeeded')}</Alert>
                )}
                {telegram.data?.linked &&
                  !telegram.data.notificationsEnabled &&
                  telegram.data.botLink && (
                    <a
                      className="btn btn--primary"
                      href={telegram.data.botLink}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {t('settings.telegramEnable')}
                    </a>
                  )}
              </div>
            </section>
          </>
        ) : (
          <Button variant="primary" block onClick={openLogin}>
            {t('auth.login')}
          </Button>
        )}
      </div>

      <Sheet open={picking} title={t('region.title')} onClose={() => setPicking(false)}>
        <RegionPicker
          current={me.data?.homeRegion?.code ?? null}
          allowAll={false}
          onSelect={(code) => {
            void choose(code, { asHome: true }).then(() => me.refetch());
            setPicking(false);
          }}
        />
      </Sheet>
    </>
  );
}
