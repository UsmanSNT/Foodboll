import { useI18n } from '../../../i18n/I18nProvider';

interface Props {
  readonly present: number;
  readonly absent: number;
  readonly unmarked: number;
}

/** Live counts of the three attendance states, updated with every tap. */
export function RosterSummary({ present, absent, unmarked }: Props) {
  const { t } = useI18n();
  const tiles = [
    { tone: 'present', label: t('organizer.roster.present'), value: present },
    { tone: 'absent', label: t('organizer.roster.absent'), value: absent },
    { tone: 'unmarked', label: t('organizer.roster.unmarked'), value: unmarked },
  ] as const;
  return (
    <section className="roster-summary" aria-label={t('organizer.roster.summary')}>
      {tiles.map((tile) => (
        <div key={tile.tone} className={`tile roster-summary__tile roster-summary__tile--${tile.tone}`}>
          <span className="tile__label">{tile.label}</span>
          <strong className="tile__value num">{tile.value}</strong>
        </div>
      ))}
    </section>
  );
}
