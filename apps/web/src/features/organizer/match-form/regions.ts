import type { RegionDto, RegionNodeDto } from '@foodboll/contracts';

/** A province with the places inside it that the organizer may announce in. */
export interface RegionGroup {
  readonly province: RegionNodeDto;
  /** Whether the province itself (the whole of it) may be chosen. */
  readonly selectable: boolean;
  readonly children: readonly RegionNodeDto[];
}

/**
 * Where a match may be announced. A granted province covers itself and every district in it, a
 * granted district only itself. `granted: null` means no restriction (admins).
 */
export function allowedRegionGroups(
  tree: readonly RegionNodeDto[],
  granted: readonly RegionDto[] | null,
): RegionGroup[] {
  const grantedCodes = granted && new Set(granted.map((region) => region.code));
  return tree.flatMap((province) => {
    const wholeProvince = grantedCodes === null || grantedCodes.has(province.code);
    const children = wholeProvince
      ? province.children
      : province.children.filter((child) => grantedCodes.has(child.code));
    return wholeProvince || children.length > 0 ? [{ province, selectable: wholeProvince, children }] : [];
  });
}

/** The only place the organizer can pick, if there is exactly one, so the form can start with it. */
export function onlyChoice(groups: readonly RegionGroup[]): string | null {
  const codes = groups.flatMap((group) => [
    ...(group.selectable ? [group.province.code] : []),
    ...group.children.map((child) => child.code),
  ]);
  return codes.length === 1 ? (codes[0] ?? null) : null;
}

export function findRegion(
  tree: readonly RegionNodeDto[],
  code: string,
): { readonly node: RegionNodeDto; readonly parent: RegionNodeDto | null } | null {
  for (const province of tree) {
    if (province.code === code) return { node: province, parent: null };
    const child = province.children.find((candidate) => candidate.code === code);
    if (child) return { node: child, parent: province };
  }
  return null;
}

/** `Gyeonggi Suwon` for a district, `Seoul` for a province. */
export const regionName = (found: NonNullable<ReturnType<typeof findRegion>>): string =>
  found.parent ? `${found.parent.name.text} ${found.node.name.text}` : found.node.name.text;

const normalize = (value: string) => value.normalize('NFKC').toLowerCase();

/** Keeps what matches the search; a district also matches through its province's name. */
export function filterRegionGroups(groups: readonly RegionGroup[], query: string): RegionGroup[] {
  const needle = normalize(query.trim());
  if (needle === '') return [...groups];
  return groups.flatMap((group) => {
    const provinceName = normalize(group.province.name.text);
    const provinceMatches = provinceName.includes(needle);
    const children = group.children.filter((child) =>
      normalize(`${provinceName} ${child.name.text}`).includes(needle),
    );
    const selectable = group.selectable && provinceMatches;
    return selectable || children.length > 0 ? [{ province: group.province, selectable, children }] : [];
  });
}
