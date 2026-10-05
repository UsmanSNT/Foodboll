import type { MatchSummaryDto, Page } from '@foodboll/contracts';
import { Link } from 'react-router-dom';
import { ErrorMessage } from '../components/ErrorMessage';
import { LocalizedText } from '../components/LocalizedText';
import { useApiResource } from '../hooks/useApiResource';
import { useI18n } from '../i18n/I18nProvider';

export function MatchesPage() {
  const { t, formatDateTime, formatKrw } = useI18n();
  const resource = useApiResource<Page<MatchSummaryDto>>('/v1/matches');

  return (
    <section>
      <h1>{t('match.listTitle')}</h1>
      {resource.status === 'loading' && <p>{t('common.loading')}</p>}
      {resource.status === 'error' && (
        <ErrorMessage error={resource.error} onRetry={resource.reload} />
      )}
      {resource.status === 'success' &&
        (resource.data.items.length === 0 ? (
          <p>{t('match.listEmpty')}</p>
        ) : (
          <ul className="cards">
            {resource.data.items.map((match) => (
              <li key={match.id} className="card">
                <Link to={`/matches/${match.id}`}>
                  <strong>
                    <LocalizedText value={match.title} />
                  </strong>
                  <span>{formatDateTime(match.startsAt)}</span>
                  <span>
                    {t('match.formatValue', { size: match.playersPerSide })} ·{' '}
                    {formatKrw(match.feeKrw)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ))}
    </section>
  );
}
