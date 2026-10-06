import type { RegionNodeDto } from '@foodboll/contracts';
import { describe, expect, it } from 'vitest';
import {
  exceedsLimit,
  filterProvinces,
  indexRegions,
  MAX_ORGANIZER_REGIONS,
  sameSelection,
  toggleCode,
  toggleProvince,
} from './region-selection';

const node = (code: string, name: string, children: RegionNodeDto[] = []): RegionNodeDto => ({
  id: `id-${code}`,
  code,
  name: { text: name, locale: 'en', isFallback: false },
  level: children.length > 0 || !code.includes('-') ? 1 : 2,
  upcomingMatches: 0,
  children,
});

const seoul = node('seoul', 'Seoul', [
  node('seoul-gangnam', 'Gangnam-gu'),
  node('seoul-songpa', 'Songpa-gu'),
]);
const gyeonggi = node('gyeonggi', 'Gyeonggi', [node('gyeonggi-suwon', 'Suwon')]);
const sejong = node('sejong', 'Sejong');
const tree = [seoul, gyeonggi, sejong];

const codes = (selection: ReadonlySet<string>) => [...selection].sort();

describe('indexRegions', () => {
  it('finds provinces and districts by code, with the province of a district', () => {
    const index = indexRegions(tree);
    expect(index.get('seoul')).toEqual({ node: seoul, parent: null });
    expect(index.get('seoul-songpa')?.parent).toBe(seoul);
    expect(index.get('nowhere')).toBeUndefined();
    expect(index.size).toBe(6);
  });
});

describe('toggleProvince', () => {
  it('replaces the districts already chosen inside it, because the province covers them', () => {
    const next = toggleProvince(new Set(['seoul-gangnam', 'gyeonggi-suwon']), seoul);
    expect(codes(next)).toEqual(['gyeonggi-suwon', 'seoul']);
  });

  it('clears only the province, leaving no district selected', () => {
    expect(codes(toggleProvince(new Set(['seoul', 'sejong']), seoul))).toEqual(['sejong']);
  });

  it('never changes the selection it was given', () => {
    const original = new Set(['seoul-gangnam']);
    toggleProvince(original, seoul);
    expect(codes(original)).toEqual(['seoul-gangnam']);
  });
});

describe('toggleCode', () => {
  it('adds a missing code and removes a present one', () => {
    expect(codes(toggleCode(new Set(), 'seoul-gangnam'))).toEqual(['seoul-gangnam']);
    expect(codes(toggleCode(new Set(['seoul-gangnam', 'sejong']), 'seoul-gangnam'))).toEqual([
      'sejong',
    ]);
  });
});

describe('limit', () => {
  const full = new Set(
    Array.from(
      { length: MAX_ORGANIZER_REGIONS },
      (_, i) =>
        `code-${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}`,
    ),
  );

  it('refuses to grow past the limit', () => {
    expect(exceedsLimit(toggleCode(full, 'extra'), full)).toBe(true);
    expect(exceedsLimit(toggleCode(new Set(['a']), 'b'), new Set(['a']))).toBe(false);
  });

  it('always allows removing, even from a list that is already over the limit', () => {
    const over = new Set([...full, 'extra', 'another']);
    const next = toggleCode(over, 'another');
    expect(next.size).toBeGreaterThan(MAX_ORGANIZER_REGIONS);
    expect(exceedsLimit(next, over)).toBe(false);
  });

  it('allows swapping districts for their province at the limit', () => {
    const atLimit = new Set(
      [...full].slice(0, MAX_ORGANIZER_REGIONS - 2).concat(['seoul-gangnam', 'seoul-songpa']),
    );
    expect(atLimit.size).toBe(MAX_ORGANIZER_REGIONS);
    expect(exceedsLimit(toggleProvince(atLimit, seoul), atLimit)).toBe(false);
  });
});

describe('sameSelection', () => {
  it('compares contents, not order or identity', () => {
    expect(sameSelection(new Set(['a', 'b']), new Set(['b', 'a']))).toBe(true);
    expect(sameSelection(new Set(['a']), new Set(['a', 'b']))).toBe(false);
    expect(sameSelection(new Set(['a', 'c']), new Set(['a', 'b']))).toBe(false);
  });
});

describe('filterProvinces', () => {
  it('keeps everything for an empty search', () => {
    expect(filterProvinces(tree, '  ').map((g) => g.province.code)).toEqual([
      'seoul',
      'gyeonggi',
      'sejong',
    ]);
  });

  it('lists every district of a province that matches by name', () => {
    const [group] = filterProvinces(tree, 'seoul');
    expect(group?.districts).toHaveLength(2);
  });

  it('keeps only the matching districts of a province that matches through them', () => {
    const groups = filterProvinces(tree, 'suwon');
    expect(groups.map((g) => g.province.code)).toEqual(['gyeonggi']);
    expect(groups[0]?.districts.map((d) => d.code)).toEqual(['gyeonggi-suwon']);
  });

  it('matches a district together with its province name, ignoring case', () => {
    expect(filterProvinces(tree, 'GYEONGGI suwon').map((g) => g.province.code)).toEqual([
      'gyeonggi',
    ]);
  });

  it('returns nothing when nothing matches', () => {
    expect(filterProvinces(tree, 'busan')).toEqual([]);
  });
});
