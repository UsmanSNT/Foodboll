import type { RosterEntryDto } from '@foodboll/contracts';
import { Link } from 'react-router-dom';
import { useI18n } from '../../../i18n/I18nProvider';
import { Avatar } from '../../../ui/Avatar';
import { Badge } from '../../../ui/Badge';
import { ChevronRight } from '../../../ui/icons';
import { AttendanceControl } from './AttendanceControl';
import type { Mark } from './roster-state';

interface Props {
  readonly entry: RosterEntryDto;
  readonly mark: Mark;
  readonly disabled: boolean;
  readonly onChange: (value: Mark) => void;
}

/** A confirmed player: who they are (links to the profile) and whether they showed up. */
export function RosterRow({ entry, mark, disabled, onChange }: Props) {
  const { t } = useI18n();
  const { player } = entry;
  return (
    <li className="card roster-row">
      <Link to={`/players/${player.id}`} className="roster-row__player">
        <Avatar name={player.displayName} id={player.id} />
        <strong className="grow roster-row__name">{player.displayName}</strong>
        <Badge tone="primary">{t('stats.levelValue', { level: player.level.level })}</Badge>
        <ChevronRight size={16} aria-hidden="true" />
      </Link>
      <AttendanceControl
        name={player.displayName}
        value={mark}
        saved={entry.attended !== null}
        disabled={disabled}
        onChange={onChange}
      />
    </li>
  );
}
