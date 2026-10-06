import type { RegionNodeDto } from '@foodboll/contracts';
import { useMemo, useState } from 'react';
import { useI18n } from '../../../i18n/I18nProvider';
import { TextInput } from '../../../ui/Field';
import { Check, Search } from '../../../ui/icons';
import { filterRegionGroups, type RegionGroup } from './regions';

interface RegionChooserProps {
  readonly groups: readonly RegionGroup[];
  readonly selected: string | null;
  readonly onSelect: (code: string) => void;
}

/** Searchable list of the places the organizer may announce in: provinces with their districts. */
export function RegionChooser({ groups, selected, onSelect }: RegionChooserProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const visible = useMemo(() => filterRegionGroups(groups, query), [groups, query]);

  const row = (node: RegionNodeDto, label: string) => (
    <li key={node.code}>
      <button
        type="button"
        className="region-row"
        aria-current={selected === node.code ? 'true' : undefined}
        onClick={() => onSelect(node.code)}
      >
        <span className="region-row__name" lang={node.name.locale}>
          {label}
        </span>
        {selected === node.code && <Check size={18} aria-hidden="true" />}
      </button>
    </li>
  );

  return (
    <div className="stack">
      <div className="search">
        <Search size={18} aria-hidden="true" />
        <TextInput
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('region.search')}
          aria-label={t('region.search')}
          autoComplete="off"
        />
      </div>

      {visible.length === 0 && <p className="muted">{t('region.noResults')}</p>}
      {visible.map(({ province, selectable, children }) =>
        province.children.length === 0 ? (
          <ul key={province.code} className="region-list">
            {row(province, province.name.text)}
          </ul>
        ) : (
          <section key={province.code}>
            <h3 className="section-title" lang={province.name.locale}>
              {province.name.text}
            </h3>
            <ul className="region-list">
              {selectable && row(province, t('region.allIn', { name: province.name.text }))}
              {children.map((child) => row(child, child.name.text))}
            </ul>
          </section>
        ),
      )}
    </div>
  );
}
