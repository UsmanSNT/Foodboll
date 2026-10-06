import type { RegionNodeDto } from '@foodboll/contracts';

/** Mirrors `setOrganizerRegionsInputSchema`; the schema stays the authority when saving. */
export const MAX_ORGANIZER_REGIONS = 50;

export interface RegionEntry {
  readonly node: RegionNodeDto;
  /** The province a district belongs to; null for a province. */
  readonly parent: RegionNodeDto | null;
}

/** Every region by code, for turning the codes the API stores into names. */
export function indexRegions(tree: readonly RegionNodeDto[]): ReadonlyMap<string, RegionEntry> {
  const index = new Map<string, RegionEntry>();
  for (const province of tree) {
    index.set(province.code, { node: province, parent: null });
    for (const district of province.children)
      index.set(district.code, { node: district, parent: province });
  }
  return index;
}

/**
 * A province grant covers all of its districts, so choosing one replaces any districts already
 * chosen inside it. Clearing it leaves them unselected rather than guessing which to keep.
 */
export function toggleProvince(
  selected: ReadonlySet<string>,
  province: RegionNodeDto,
): Set<string> {
  const next = new Set(selected);
  if (next.delete(province.code)) return next;
  next.add(province.code);
  for (const district of province.children) next.delete(district.code);
  return next;
}

/** Adds or removes one code: a district, or a region the tree no longer lists. */
export function toggleCode(selected: ReadonlySet<string>, code: string): Set<string> {
  const next = new Set(selected);
  if (!next.delete(code)) next.add(code);
  return next;
}

/** Choosing this would take the selection past the limit (swapping districts for their province never does). */
export function exceedsLimit(next: ReadonlySet<string>, current: ReadonlySet<string>): boolean {
  return next.size > MAX_ORGANIZER_REGIONS && next.size > current.size;
}

export function sameSelection(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return a.size === b.size && [...a].every((code) => b.has(code));
}

export interface ProvinceGroup {
  readonly province: RegionNodeDto;
  /** The districts to list: all of them, or only those the search found. */
  readonly districts: readonly RegionNodeDto[];
}

const normalize = (value: string) => value.normalize('NFKC').toLowerCase();

/** Keeps provinces that match, or contain a district that does; a matching province lists all of its districts. */
export function filterProvinces(tree: readonly RegionNodeDto[], query: string): ProvinceGroup[] {
  const needle = normalize(query.trim());
  if (needle === '') return tree.map((province) => ({ province, districts: province.children }));
  return tree.flatMap((province) => {
    const provinceName = normalize(province.name.text);
    if (provinceName.includes(needle)) return [{ province, districts: province.children }];
    const districts = province.children.filter((district) =>
      normalize(`${provinceName} ${district.name.text}`).includes(needle),
    );
    return districts.length > 0 ? [{ province, districts }] : [];
  });
}
