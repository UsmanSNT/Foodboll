import { useMemo } from 'react';
import { useI18n } from '../../i18n/I18nProvider';
import { upcomingDays } from '../../lib/dates';
import { Chip } from '../../ui/Chip';

const DAYS_AHEAD = 14;

/** Horizontal day picker: "All" plus the next two weeks, in Korean dates. */
export function DateStrip({
  value,
  onChange,
}: {
  readonly value: string | null;
  readonly onChange: (date: string | null) => void;
}) {
  const { t, formatDate } = useI18n();
  const days = useMemo(() => upcomingDays(DAYS_AHEAD), []);
  return (
    <div className="chips" role="group" aria-label={t('feed.allDays')}>
      <Chip day selected={value === null} onClick={() => onChange(null)}>
        <span className="chip__dow" aria-hidden="true">
          &nbsp;
        </span>
        <span className="chip__day chip__day--text">{t('feed.allDays')}</span>
      </Chip>
      {days.map((day, index) => {
        const weekday =
          index === 0 ? t('feed.today') : t('format.weekdayShort', { weekday: day.weekday });
        return (
          <Chip
            key={day.key}
            day
            selected={value === day.key}
            onClick={() => onChange(day.key)}
            // The name starts with the visible text so voice control can say what it sees.
            aria-label={`${weekday} ${day.day}, ${formatDate(`${day.key}T12:00:00+09:00`)}`}
          >
            <span className="chip__dow">{weekday}</span>
            <span className="chip__day num">{day.day}</span>
          </Chip>
        );
      })}
    </div>
  );
}
