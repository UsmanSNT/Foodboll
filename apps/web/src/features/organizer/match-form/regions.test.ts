import type { RegionDto, RegionNodeDto } from '@foodboll/contracts';
import { describe, expect, it } from 'vitest';
import {
  allowedRegionGroups,
  filterRegionGroups,
  findRegion,
  onlyChoice,
  regionName,
} from './regions';

const name = (text: string) => ({ text, locale: 'en' as const, isFallback: false });
const node = (
  code: string,
  text: string,
  level: 1 | 2,
  children: RegionNodeDto[] = [],
): RegionNodeDto => ({
  id: `id-${code}`,
  code,
  name: name(text),
  level,
  upcomingMatches: 0,
  children,
});
const granted = (code: string, text: string, level: 1 | 2): RegionDto => ({
  id: `id-${code}`,
  code,
  name: name(text),
  level,
  parent: null,
});

const tree = [
  node('seoul', 'Seoul', 1, [
    node('seoul-gangnam', 'Gangnam-gu', 2),
    node('seoul-mapo', 'Mapo-gu', 2),
  ]),
  node('gyeonggi', 'Gyeonggi', 1, [
    node('gyeonggi-suwon', 'Suwon', 2),
    node('gyeonggi-ansan', 'Ansan', 2),
  ]),
  node('sejong', 'Sejong', 1),
];
const codes = (groups: ReturnType<typeof allowedRegionGroups>) =>
  groups.flatMap((g) => [
    ...(g.selectable ? [g.province.code] : []),
    ...g.children.map((c) => c.code),
  ]);

describe('allowedRegionGroups', () => {
  it('lets a granted province cover itself and all its districts', () => {
    const groups = allowedRegionGroups(tree, [granted('gyeonggi', 'Gyeonggi', 1)]);
    expect(codes(groups)).toEqual(['gyeonggi', 'gyeonggi-suwon', 'gyeonggi-ansan']);
    expect(groups[0]?.selectable).toBe(true);
  });

  it('lets a granted district cover only itself, without offering its province', () => {
    const groups = allowedRegionGroups(tree, [granted('gyeonggi-ansan', 'Ansan', 2)]);
    expect(codes(groups)).toEqual(['gyeonggi-ansan']);
    expect(groups[0]?.selectable).toBe(false);
  });

  it('combines several grants and ignores districts that sit under a granted province', () => {
    const groups = allowedRegionGroups(tree, [
      granted('seoul-mapo', 'Mapo-gu', 2),
      granted('gyeonggi', 'Gyeonggi', 1),
      granted('gyeonggi-ansan', 'Ansan', 2),
      granted('sejong', 'Sejong', 1),
    ]);
    expect(codes(groups)).toEqual([
      'seoul-mapo',
      'gyeonggi',
      'gyeonggi-suwon',
      'gyeonggi-ansan',
      'sejong',
    ]);
  });

  it('offers nothing without grants, and everything without restriction', () => {
    expect(allowedRegionGroups(tree, [])).toEqual([]);
    expect(codes(allowedRegionGroups(tree, null))).toHaveLength(3 + 4);
  });

  it('skips grants for regions that are switched off (not in the tree)', () => {
    expect(allowedRegionGroups(tree, [granted('busan', 'Busan', 1)])).toEqual([]);
  });
});

describe('onlyChoice', () => {
  it('returns the code when exactly one place can be chosen', () => {
    expect(onlyChoice(allowedRegionGroups(tree, [granted('seoul-mapo', 'Mapo-gu', 2)]))).toBe(
      'seoul-mapo',
    );
    expect(onlyChoice(allowedRegionGroups(tree, [granted('sejong', 'Sejong', 1)]))).toBe('sejong');
  });

  it('returns null when there is a choice to make', () => {
    expect(onlyChoice(allowedRegionGroups(tree, [granted('seoul', 'Seoul', 1)]))).toBeNull();
    expect(
      onlyChoice(
        allowedRegionGroups(tree, [
          granted('seoul-mapo', 'Mapo-gu', 2),
          granted('sejong', 'Sejong', 1),
        ]),
      ),
    ).toBeNull();
    expect(onlyChoice([])).toBeNull();
  });
});

describe('findRegion and regionName', () => {
  it('finds provinces and districts and names a district with its province', () => {
    const district = findRegion(tree, 'gyeonggi-suwon');
    expect(district?.parent?.code).toBe('gyeonggi');
    expect(district && regionName(district)).toBe('Gyeonggi Suwon');
    const province = findRegion(tree, 'seoul');
    expect(province && regionName(province)).toBe('Seoul');
    expect(findRegion(tree, 'busan')).toBeNull();
  });
});

describe('filterRegionGroups', () => {
  const groups = allowedRegionGroups(tree, null);

  it('returns everything for an empty search', () => {
    expect(filterRegionGroups(groups, '  ')).toEqual(groups);
  });

  it('finds a district by its own name, without offering its whole province', () => {
    const found = filterRegionGroups(groups, 'SUWON');
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ selectable: false });
    expect(codes(found)).toEqual(['gyeonggi-suwon']);
  });

  it('finds a province with all its districts', () => {
    expect(codes(filterRegionGroups(groups, 'gyeonggi'))).toEqual([
      'gyeonggi',
      'gyeonggi-suwon',
      'gyeonggi-ansan',
    ]);
  });

  it('finds a district by province and district together', () => {
    expect(codes(filterRegionGroups(groups, 'seoul mapo'))).toEqual(['seoul-mapo']);
  });

  it('returns nothing when nothing matches', () => {
    expect(filterRegionGroups(groups, 'busan')).toEqual([]);
  });
});
