import { Link } from 'react-router-dom';
import { useI18n } from '../i18n/I18nProvider';

interface Crumb {
  readonly label: string;
  readonly to?: string;
}

/** 마이페이지 → 설정 → 언어  /  Profil → Sozlamalar → Til */
export function Breadcrumb({ trail }: { readonly trail: readonly Crumb[] }) {
  const { t } = useI18n();
  return (
    <nav aria-label={t('nav.breadcrumb')} className="breadcrumb">
      <ol>
        {trail.map((crumb, index) => (
          <li key={crumb.label} aria-current={index === trail.length - 1 ? 'page' : undefined}>
            {crumb.to ? <Link to={crumb.to}>{crumb.label}</Link> : crumb.label}
          </li>
        ))}
      </ol>
    </nav>
  );
}
