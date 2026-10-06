import { useI18n } from '../../../i18n/I18nProvider';
import { ShieldCheck } from '../../../ui/icons';

/** Organizers must never feel responsible for payments: they are verified automatically. */
export function PaymentsNote() {
  const { t } = useI18n();
  return (
    <div className="card organizer-note">
      <span className="organizer-note__icon" aria-hidden="true">
        <ShieldCheck size={22} />
      </span>
      <div className="stack organizer-note__text">
        <h2>{t('organizer.home.paymentsTitle')}</h2>
        <p>{t('organizer.home.paymentsText')}</p>
      </div>
    </div>
  );
}
