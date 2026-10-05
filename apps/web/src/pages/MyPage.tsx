import { LEGAL_DOCUMENT_LABEL_KEY, LEGAL_DOCUMENT_TYPES } from '@foodboll/contracts';
import { Link } from 'react-router-dom';
import { useI18n } from '../i18n/I18nProvider';

export function MyPage() {
  const { t } = useI18n();
  return (
    <section>
      <h1>{t('myPage.title')}</h1>
      <ul className="menu">
        <li>
          <Link to="/me/settings">{t('myPage.settings')}</Link>
        </li>
        <li>
          <Link to="/me/registrations">{t('myPage.registrations')}</Link>
        </li>
        <li>
          <Link to="/me/payment">{t('myPage.paymentInfo')}</Link>
        </li>
      </ul>
      <h2>{t('myPage.legal')}</h2>
      <ul className="menu">
        {LEGAL_DOCUMENT_TYPES.map((type) => (
          <li key={type}>
            <Link to={`/legal/${type}`}>{t(LEGAL_DOCUMENT_LABEL_KEY[type])}</Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
