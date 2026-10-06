import { Link } from 'react-router-dom';
import { useMe } from '../../api/queries';
import { useI18n } from '../../i18n/I18nProvider';
import { ChevronRight, ClipboardCheck, Flag, ShieldCheck } from '../../ui/icons';

/** Organizer and admin entry points on My page; players are offered the way to become an organizer. */
export function RoleLinks() {
  const { t } = useI18n();
  const me = useMe();
  if (!me.data) return null;

  const links =
    me.data.role === 'PLAYER'
      ? [{ to: '/organizer/apply', icon: <Flag size={18} />, label: t('myPage.becomeOrganizer') }]
      : [
          { to: '/organizer', icon: <ClipboardCheck size={18} />, label: t('myPage.organizerTools') },
          ...(me.data.role === 'ADMIN'
            ? [{ to: '/admin', icon: <ShieldCheck size={18} />, label: t('myPage.adminTools') }]
            : []),
        ];

  return (
    <ul className="card list">
      {links.map((link) => (
        <li key={link.to}>
          <Link to={link.to} className="list__item">
            <span aria-hidden="true">{link.icon}</span>
            <span className="grow">{link.label}</span>
            <ChevronRight size={16} aria-hidden="true" />
          </Link>
        </li>
      ))}
    </ul>
  );
}
