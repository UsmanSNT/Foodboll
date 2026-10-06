import { useState } from 'react';
import { useI18n } from '../../../i18n/I18nProvider';
import { koreanDateKey } from '../../../lib/dates';
import { Field, TextInput } from '../../../ui/Field';
import { Calendar } from '../../../ui/icons';
import type { FieldMessages, FormState } from './form-state';
import { resolveWindow, splitDuration, type MatchWindow } from './kst';

type When = Pick<FormState, 'date' | 'startTime' | 'endTime'>;

interface WhenFieldsProps {
  readonly value: When;
  readonly errors: FieldMessages;
  readonly onChange: (patch: Partial<When>) => void;
}

/** Date and times in Korean time, with a live summary of what will be announced. */
export function WhenFields({ value, errors, onChange }: WhenFieldsProps) {
  const { t } = useI18n();
  // Earlier days cannot be picked; fixed when the form opens, the API checks the real start.
  const [today] = useState(() => koreanDateKey(new Date()));
  const schedule = resolveWindow(value.date, value.startTime, value.endTime);

  return (
    <>
      <p className="small muted">{t('matchForm.when.note')}</p>
      <Field label={t('matchForm.when.date')} error={errors.date}>
        {(props) => (
          <TextInput
            {...props}
            type="date"
            min={today}
            value={value.date}
            onChange={(event) => onChange({ date: event.target.value })}
          />
        )}
      </Field>
      <div className="mf-times">
        <Field label={t('matchForm.when.start')} error={errors.startTime}>
          {(props) => (
            <TextInput
              {...props}
              type="time"
              value={value.startTime}
              onChange={(event) => onChange({ startTime: event.target.value })}
            />
          )}
        </Field>
        <Field label={t('matchForm.when.end')} error={errors.endTime}>
          {(props) => (
            <TextInput
              {...props}
              type="time"
              value={value.endTime}
              onChange={(event) => onChange({ endTime: event.target.value })}
            />
          )}
        </Field>
      </div>
      <Summary schedule={schedule} startTime={value.startTime} endTime={value.endTime} />
    </>
  );
}

function Summary({
  schedule,
  startTime,
  endTime,
}: {
  readonly schedule: MatchWindow | null;
  readonly startTime: string;
  readonly endTime: string;
}) {
  const { t, formatDate } = useI18n();

  return (
    <div className="mf-summary" role="status">
      <Calendar size={18} aria-hidden="true" />
      {schedule ? (
        <div>
          <p className="mf-summary__main num">
            {[formatDate(schedule.startsAt), `${startTime}–${endTime}`, t('match.kst')].join(' · ')}
          </p>
          <p className="small">
            {[
              durationLabel(schedule.minutes, t),
              ...(schedule.endsNextDay
                ? [t('matchForm.when.endsNextDay', { date: formatDate(schedule.endsAt) })]
                : []),
            ].join(' · ')}
          </p>
        </div>
      ) : (
        <p className="small">{t('matchForm.when.empty')}</p>
      )}
    </div>
  );
}

function durationLabel(totalMinutes: number, t: ReturnType<typeof useI18n>['t']): string {
  const { hours, minutes } = splitDuration(totalMinutes);
  if (hours === 0) return t('matchForm.when.lastsMinutes', { minutes });
  if (minutes === 0) return t('matchForm.when.lastsHours', { hours });
  return t('matchForm.when.lastsBoth', { hours, minutes });
}
