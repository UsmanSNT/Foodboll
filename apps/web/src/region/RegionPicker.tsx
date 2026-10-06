import type { RegionNodeDto } from '@foodboll/contracts';
import { useMemo, useState } from 'react';
import { useRegionTree } from '../api/queries';
import { useI18n } from '../i18n/I18nProvider';
import { Button } from '../ui/Button';
import { TextInput } from '../ui/Field';
import { ArrowLeft, ChevronRight, Globe, MapPin, Search } from '../ui/icons';
import { Skeleton } from '../ui/Skeleton';
import { ErrorState } from '../ui/ErrorState';

interface RegionPickerProps {
  /** Currently selected region code (null = all regions). */
  readonly current: string | null;
  /** Offer an "all regions" row (browsing) or require a concrete region (home region, forms). */
  readonly allowAll: boolean;
  readonly onSelect: (code: string | null) => void;
}

const normalize = (value: string) => value.normalize('NFKC').toLowerCase();

/**
 * Two-step picker: provinces first, then the districts inside one. Typing in the search box
 * switches to a flat list across both levels, so a district can be found without knowing its province.
 */
export function RegionPicker({ current, allowAll, onSelect }: RegionPickerProps) {
  const { t } = useI18n();
  const tree = useRegionTree();
  const [province, setProvince] = useState<RegionNodeDto | null>(null);
  const [query, setQuery] = useState('');

  const flat = useMemo(() => {
    const q = normalize(query.trim());
    if (!q || !tree.data) return [];
    return tree.data.items.flatMap((p) => [
      ...(normalize(p.name.text).includes(q) ? [{ node: p, parent: null as RegionNodeDto | null }] : []),
      ...p.children.filter((c) => normalize(c.name.text).includes(q)).map((c) => ({ node: c, parent: p })),
    ]);
  }, [query, tree.data]);

  if (tree.isPending) {
    return (
      <div className="stack" aria-busy="true">
        <Skeleton height={46} />
        <Skeleton height={56} />
        <Skeleton height={56} />
        <Skeleton height={56} />
      </div>
    );
  }
  if (tree.isError) return <ErrorState error={tree.error} onRetry={() => void tree.refetch()} />;

  const row = (node: RegionNodeDto, label: string, options: { drill?: boolean; sub?: string } = {}) => (
    <li key={node.code + label}>
      <button
        type="button"
        className="region-row"
        aria-current={current === node.code ? 'true' : undefined}
        onClick={() => (options.drill ? setProvince(node) : onSelect(node.code))}
      >
        <span className="region-row__name">
          <span lang={node.name.locale}>{label}</span>
          {options.sub && <small className="muted">{options.sub}</small>}
        </span>
        <span className="muted small num">{t('region.matchCount', { count: node.upcomingMatches })}</span>
        {options.drill && <ChevronRight size={18} aria-hidden="true" />}
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

      {query.trim() ? (
        flat.length === 0 ? (
          <p className="muted">{t('region.noResults')}</p>
        ) : (
          <ul className="region-list">
            {flat.map(({ node, parent }) =>
              row(node, node.name.text, parent ? { sub: parent.name.text } : {}),
            )}
          </ul>
        )
      ) : province ? (
        <>
          <Button variant="ghost" size="sm" onClick={() => setProvince(null)}>
            <ArrowLeft size={16} aria-hidden="true" />
            {province.name.text}
          </Button>
          <ul className="region-list">
            {row(province, t('region.allIn', { name: province.name.text }))}
            {province.children.map((child) => row(child, child.name.text))}
          </ul>
        </>
      ) : (
        <ul className="region-list">
          {allowAll && (
            <li>
              <button
                type="button"
                className="region-row"
                aria-current={current === null ? 'true' : undefined}
                onClick={() => onSelect(null)}
              >
                <span className="region-row__name">
                  <Globe size={18} aria-hidden="true" />
                  {t('region.all')}
                </span>
              </button>
            </li>
          )}
          {tree.data.items.map((p) =>
            p.children.length > 0
              ? row(p, p.name.text, { drill: true })
              : row(p, p.name.text),
          )}
        </ul>
      )}
    </div>
  );
}

/** The small pill showing the active region; opens the picker. */
export function RegionPill({ label, onClick }: { readonly label: string; readonly onClick: () => void }) {
  const { t } = useI18n();
  return (
    <button type="button" className="region-pill" onClick={onClick} aria-label={t('region.change')}>
      <MapPin size={16} aria-hidden="true" />
      <span>{label}</span>
    </button>
  );
}
