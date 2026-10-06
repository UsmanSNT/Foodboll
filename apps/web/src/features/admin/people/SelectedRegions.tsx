import { useId } from 'react';
import { useI18n } from '../../../i18n/I18nProvider';
import { X } from '../../../ui/icons';
import { MAX_ORGANIZER_REGIONS, type RegionEntry } from './region-selection';

interface Props {
  readonly selected: ReadonlySet<string>;
  readonly regions: ReadonlyMap<string, RegionEntry>;
  readonly onRemove: (code: string) => void;
}

/** What is granted right now, as removable chips; a province reads "All of …" because it covers its districts. */
export function SelectedRegions({ selected, regions, onRemove }: Props) {
  const { t } = useI18n();
  const titleId = useId();
  const codes = [...selected].sort();

  const labelOf = (code: string): string => {
    const entry = regions.get(code);
    if (!entry) return t('adminPeople.regions.unknown');
    return entry.parent
      ? `${entry.parent.name.text} ${entry.node.name.text}`
      : t('region.allIn', { name: entry.node.name.text });
  };

  return (
    <section className="stack" aria-labelledby={titleId}>
      <div className="row row--between">
        <h3 id={titleId} className="section-title people-selected__title">
          {t('adminPeople.regions.selectedTitle')}
        </h3>
        <span className="small muted num">
          {t('adminPeople.regions.selectedCount', {
            count: codes.length,
            max: MAX_ORGANIZER_REGIONS,
          })}
        </span>
      </div>
      {codes.length === 0 ? (
        <p className="small muted">{t('adminPeople.regions.selectedNone')}</p>
      ) : (
        <ul className="people-chips">
          {codes.map((code) => {
            const label = labelOf(code);
            return (
              <li key={code} className="people-chip">
                <span className="people-chip__label">{label}</span>
                <button
                  type="button"
                  className="people-chip__remove"
                  aria-label={t('adminPeople.regions.remove', { name: label })}
                  onClick={() => onRemove(code)}
                >
                  <X size={16} aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
