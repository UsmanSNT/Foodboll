import type { MatchSummaryDto } from '@foodboll/contracts';
import { useI18n } from '../../i18n/I18nProvider';
import { formatTimeRange, regionLabel } from '../../lib/match';
import { Calendar, MapPin } from '../../ui/icons';

/** When and where, with icons; shared by the match page and the registration page. */
export function MatchFacts({ match }: { readonly match: MatchSummaryDto }) {
  const { t, formatDate } = useI18n();
  return (
    <ul className="facts">
      <li>
        <Calendar size={18} aria-hidden="true" />
        <span>
          <strong>{formatDate(match.startsAt)}</strong> · <span className="num">{formatTimeRange(match.startsAt, match.endsAt)}</span>
          <small className="muted"> {t('match.kst')}</small>
        </span>
      </li>
      <li>
        <MapPin size={18} aria-hidden="true" />
        <span>
          <strong>{match.venueName}</strong>
          <small className="muted"> · {regionLabel(match.region)}</small>
        </span>
      </li>
    </ul>
  );
}
