import { Link } from 'react-router-dom';
import { useI18n } from '../../i18n/I18nProvider';
import { Banknote, ChevronRight, ClipboardCheck, ShieldCheck, Users, Wallet } from '../../ui/icons';
import { PageHeader } from '../../ui/PageHeader';

export function AdminHomePage() {
  const { t } = useI18n();
  const tools = [
    { to: '/admin/payments', icon: <Wallet size={20} />, label: t('adminHome.payments') },
    { to: '/admin/deposits', icon: <Banknote size={20} />, label: t('adminHome.deposits') },
    { to: '/admin/applications', icon: <ClipboardCheck size={20} />, label: t('adminHome.applications') },
    { to: '/admin/users', icon: <Users size={20} />, label: t('adminHome.users') },
    { to: '/admin/payment-info', icon: <Wallet size={20} />, label: t('adminHome.paymentInfo') },
    { to: '/admin/legal', icon: <ShieldCheck size={20} />, label: t('adminHome.legal') },
  ];
  return (
    <>
      <PageHeader back title={t('adminHome.title')} />
      <div className="page">
        <ul className="card list">
          {tools.map((tool) => (
            <li key={tool.to}>
              <Link to={tool.to} className="list__item">
                <span aria-hidden="true">{tool.icon}</span>
                <span className="grow">{tool.label}</span>
                <ChevronRight size={16} aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
