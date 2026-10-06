import type { MessageKey } from '@foodboll/i18n';
import { useI18n } from '../../../i18n/I18nProvider';
import type { Mark } from './roster-state';

const OPTIONS = [
  { mark: true, tone: 'present', label: 'organizer.roster.present' },
  { mark: false, tone: 'absent', label: 'organizer.roster.absent' },
  { mark: null, tone: 'unmarked', label: 'organizer.roster.unmarked' },
] as const satisfies readonly { mark: Mark; tone: string; label: MessageKey }[];

interface Props {
  readonly name: string;
  readonly value: Mark;
  /** The server already holds a mark; the API can change it but never clear it. */
  readonly saved: boolean;
  readonly disabled: boolean;
  readonly onChange: (value: Mark) => void;
}

/** Present / absent / not marked for one player, as three large toggle buttons. */
export function AttendanceControl({ name, value, saved, disabled, onChange }: Props) {
  const { t } = useI18n();
  return (
    <div className="attendance" role="group" aria-label={t('organizer.roster.groupLabel', { name })}>
      {OPTIONS.map((option) => (
        <button
          key={option.tone}
          type="button"
          className={`attendance__option attendance__option--${option.tone}`}
          aria-pressed={value === option.mark}
          disabled={disabled || (option.mark === null && saved)}
          onClick={() => onChange(option.mark)}
        >
          {t(option.label)}
        </button>
      ))}
    </div>
  );
}
