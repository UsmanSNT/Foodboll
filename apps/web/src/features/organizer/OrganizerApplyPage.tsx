import { useMe } from '../../api/queries';
import { useI18n } from '../../i18n/I18nProvider';
import { Alert } from '../../ui/Alert';
import { ClipboardCheck, MapPin, ShieldCheck } from '../../ui/icons';
import { PageHeader } from '../../ui/PageHeader';
import { ApplicationList } from './home/ApplicationList';
import { ApplyForm } from './home/ApplyForm';

export function OrganizerApplyPage() {
  const { t } = useI18n();
  const me = useMe();
  const points = [
    { icon: <MapPin size={18} />, text: t('organizer.apply.pointCity') },
    { icon: <ShieldCheck size={18} />, text: t('organizer.apply.pointReview') },
    { icon: <ClipboardCheck size={18} />, text: t('organizer.apply.pointPayments') },
  ];

  return (
    <>
      <PageHeader back title={t('organizer.apply.title')} />
      <div className="page">
        <ul className="card card--pad stack apply-points">
          {points.map((point) => (
            <li key={point.text} className="apply-point">
              <span className="apply-point__icon" aria-hidden="true">
                {point.icon}
              </span>
              <span>{point.text}</span>
            </li>
          ))}
        </ul>
        {me.data?.role === 'ADMIN' ? <Alert tone="info">{t('organizer.apply.adminNote')}</Alert> : <ApplyForm />}
        <ApplicationList />
      </div>
    </>
  );
}
