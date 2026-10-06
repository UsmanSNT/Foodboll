import type { RegionNodeDto } from '@foodboll/contracts';
import { useMemo, useState } from 'react';
import { useI18n } from '../../../i18n/I18nProvider';
import { TextInput } from '../../../ui/Field';
import { Search } from '../../../ui/icons';
import { ProvinceItem } from './ProvinceItem';
import { filterProvinces } from './region-selection';

interface Props {
  readonly tree: readonly RegionNodeDto[];
  readonly selected: ReadonlySet<string>;
  readonly onChange: (next: ReadonlySet<string>) => void;
}

/** Provinces to open and tick, with a search that opens whatever it finds. */
export function RegionChecklist({ tree, selected, onChange }: Props) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const groups = useMemo(() => filterProvinces(tree, query), [tree, query]);
  const searching = query.trim() !== '';

  const toggleOpen = (code: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(code)) next.add(code);
      return next;
    });

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
      {groups.length === 0 ? (
        <p className="muted">{t('region.noResults')}</p>
      ) : (
        <ul className="people-provinces" aria-label={t('adminPeople.regions.listLabel')}>
          {groups.map(({ province, districts }) => (
            <ProvinceItem
              key={province.code}
              province={province}
              districts={districts}
              selected={selected}
              onChange={onChange}
              expanded={searching || open.has(province.code)}
              {...(!searching && { onToggleExpanded: () => toggleOpen(province.code) })}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
