import type { LocalizedValueDto, MatchDto } from '@foodboll/contracts';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { apiRequest, ApiError } from '../api/client';
import { ErrorMessage } from '../components/ErrorMessage';
import { LocalizedText } from '../components/LocalizedText';
import { useApiResource } from '../hooks/useApiResource';
import { useI18n } from '../i18n/I18nProvider';

export function MatchDetailPage() {
  const { id = '' } = useParams();
  const { t, formatDateTime, formatKrw } = useI18n();
  const resource = useApiResource<MatchDto>(`/v1/matches/${encodeURIComponent(id)}`);
  const { locale } = useI18n();
  const navigate = useNavigate();
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<ApiError | null>(null);

  async function apply() {
    setApplying(true);
    setApplyError(null);
    try {
      await apiRequest(`/v1/matches/${encodeURIComponent(id)}/registrations`, {
        method: 'POST',
        locale,
      });
      void navigate('/me/registrations');
    } catch (error) {
      setApplyError(error instanceof ApiError ? error : new ApiError('INTERNAL_ERROR', 0));
      setApplying(false);
    }
  }

  if (resource.status === 'loading') return <p>{t('common.loading')}</p>;
  if (resource.status === 'error')
    return <ErrorMessage error={resource.error} onRetry={resource.reload} />;

  const match = resource.data;
  const sections: readonly [string, LocalizedValueDto | null][] = [
    [t('match.description'), match.description],
    [t('match.rules'), match.rules],
    [t('match.locationInstructions'), match.locationInstructions],
    [t('match.equipmentRequirements'), match.equipmentRequirements],
    [t('match.cancellationPolicy'), match.cancellationPolicy],
  ];

  return (
    <article>
      <h1>
        <LocalizedText value={match.title} />
      </h1>
      <dl className="facts">
        <dt>{t('match.startsAt')}</dt>
        <dd>{formatDateTime(match.startsAt)}</dd>
        <dt>{t('match.format')}</dt>
        <dd>{t('match.formatValue', { size: match.playersPerSide })}</dd>
        <dt>{t('match.fee')}</dt>
        <dd>{formatKrw(match.feeKrw)}</dd>
        <dt>{t('match.maxPlayers')}</dt>
        <dd>{match.maxPlayers}</dd>
      </dl>
      <button type="button" className="primary" disabled={applying} onClick={() => void apply()}>
        {t('match.apply')}
      </button>
      {applyError && <ErrorMessage error={applyError} />}
      {sections.map(
        ([heading, value]) =>
          value && (
            <section key={heading}>
              <h2>{heading}</h2>
              <p className="prewrap">
                <LocalizedText value={value} />
              </p>
            </section>
          ),
      )}
    </article>
  );
}
