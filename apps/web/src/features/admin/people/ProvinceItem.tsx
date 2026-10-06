import type { RegionNodeDto } from '@foodboll/contracts';
import { useId } from 'react';
import { useI18n } from '../../../i18n/I18nProvider';
import { ChevronDown } from '../../../ui/icons';
import { exceedsLimit, toggleCode, toggleProvince } from './region-selection';

interface Props {
  readonly province: RegionNodeDto;
  /** The districts to list (all of them, or the ones a search found). */
  readonly districts: readonly RegionNodeDto[];
  readonly selected: ReadonlySet<string>;
  readonly onChange: (next: ReadonlySet<string>) => void;
  readonly expanded: boolean;
  /** Absent while a search keeps every match open. */
  readonly onToggleExpanded?: () => void;
}

/** A province with its own checkbox and, once opened, one per district. A selected province covers them all. */
export function ProvinceItem({ province, districts, selected, onChange, expanded, onToggleExpanded }: Props) {
  const { t } = useI18n();
  const listId = useId();
  const whole = selected.has(province.code);
  const pickedDistricts = province.children.filter((district) => selected.has(district.code)).length;
  const hasDistricts = province.children.length > 0;

  return (
    <li className="people-province">
      <div className="people-province__head">
        <label className="people-check">
          <input
            type="checkbox"
            checked={whole}
            disabled={!whole && exceedsLimit(toggleProvince(selected, province), selected)}
            onChange={() => onChange(toggleProvince(selected, province))}
          />
          <span className="people-check__text">
            <span lang={province.name.locale}>{province.name.text}</span>
            {whole && hasDistricts && <small className="muted">{t('adminPeople.regions.covered')}</small>}
            {!whole && pickedDistricts > 0 && <small className="muted">{t('adminPeople.regions.selectedIn', { count: pickedDistricts })}</small>}
          </span>
        </label>
        {hasDistricts && onToggleExpanded && (
          <button
            type="button"
            className="btn btn--ghost btn--icon people-province__toggle"
            aria-expanded={expanded}
            aria-controls={expanded ? listId : undefined}
            aria-label={t('adminPeople.regions.districtsOf', { name: province.name.text })}
            onClick={onToggleExpanded}
          >
            <ChevronDown size={20} aria-hidden="true" />
          </button>
        )}
      </div>
      {expanded && districts.length > 0 && (
        <ul id={listId} className="people-districts" aria-label={t('adminPeople.regions.districtsOf', { name: province.name.text })}>
          {districts.map((district) => {
            const picked = selected.has(district.code);
            return (
              <li key={district.code}>
                <label className="people-check">
                  <input
                    type="checkbox"
                    checked={whole || picked}
                    disabled={whole || (!picked && exceedsLimit(toggleCode(selected, district.code), selected))}
                    onChange={() => onChange(toggleCode(selected, district.code))}
                  />
                  <span className="people-check__text">
                    <span lang={district.name.locale}>{district.name.text}</span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}
