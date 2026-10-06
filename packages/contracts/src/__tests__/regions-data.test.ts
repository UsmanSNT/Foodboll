import { describe, expect, it } from 'vitest';
import { REGION_SEEDS, type RegionSeed } from '../regions-data';

const LEVEL1_CODES = [
  'seoul',
  'busan',
  'daegu',
  'incheon',
  'gwangju',
  'daejeon',
  'ulsan',
  'sejong',
  'gyeonggi',
  'gangwon',
  'chungbuk',
  'chungnam',
  'jeonbuk',
  'jeonnam',
  'gyeongbuk',
  'gyeongnam',
  'jeju',
] as const;

const EXPECTED_CHILD_COUNTS: Readonly<Record<(typeof LEVEL1_CODES)[number], number>> = {
  seoul: 25,
  busan: 16,
  daegu: 9,
  incheon: 11,
  gwangju: 5,
  daejeon: 5,
  ulsan: 5,
  sejong: 0,
  gyeonggi: 31,
  gangwon: 5,
  chungbuk: 6,
  chungnam: 7,
  jeonbuk: 7,
  jeonnam: 6,
  gyeongbuk: 8,
  gyeongnam: 7,
  jeju: 2,
};

const EXPECTED_LEVEL1_KO = [
  '서울',
  '부산',
  '대구',
  '인천',
  '광주',
  '대전',
  '울산',
  '세종',
  '경기',
  '강원',
  '충북',
  '충남',
  '전북',
  '전남',
  '경북',
  '경남',
  '제주',
] as const;

const CODE_PATTERN = /^[a-z]+(-[a-z]+)*$/;
const HANGUL_ONLY = /^[가-힣]+$/;
const ASCII_NAME = /^[A-Za-z]+(?:[ -][A-Za-z]+)*$/;

const level1: readonly RegionSeed[] = REGION_SEEDS.filter((r) => r.parent === null);
const level2: readonly RegionSeed[] = REGION_SEEDS.filter((r) => r.parent !== null);

describe('REGION_SEEDS level-1', () => {
  it('has exactly 17 provinces / metropolitan cities', () => {
    expect(level1).toHaveLength(17);
  });

  it('lists them in the agreed order with the agreed codes and sort orders', () => {
    const ordered = [...level1].sort((a, b) => a.sortOrder - b.sortOrder);
    expect(ordered.map((r) => r.code)).toEqual([...LEVEL1_CODES]);
    expect(ordered.map((r) => r.sortOrder)).toEqual(LEVEL1_CODES.map((_, i) => i + 1));
  });

  it('uses the short everyday Korean names', () => {
    const ordered = [...level1].sort((a, b) => a.sortOrder - b.sortOrder);
    expect(ordered.map((r) => r.names.ko)).toEqual([...EXPECTED_LEVEL1_KO]);
  });

  it('romanizes Seoul as Seul in Uzbek and keeps English as Seoul', () => {
    const seoul = level1.find((r) => r.code === 'seoul');
    expect(seoul?.names.en).toBe('Seoul');
    expect(seoul?.names.uz).toBe('Seul');
  });
});

describe('REGION_SEEDS level-2 counts', () => {
  for (const code of LEVEL1_CODES) {
    it(`${code} has exactly ${EXPECTED_CHILD_COUNTS[code]} children`, () => {
      expect(level2.filter((r) => r.parent === code)).toHaveLength(EXPECTED_CHILD_COUNTS[code]);
    });
  }

  it('has no other level-1 regions with children than the listed ones', () => {
    const total = Object.values(EXPECTED_CHILD_COUNTS).reduce((a, b) => a + b, 0);
    expect(level2).toHaveLength(total);
    expect(REGION_SEEDS).toHaveLength(total + 17);
  });
});

describe('REGION_SEEDS integrity', () => {
  it('has unique codes', () => {
    const codes = REGION_SEEDS.map((r) => r.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('references only existing level-1 parents', () => {
    const level1Codes = new Set(level1.map((r) => r.code));
    const allCodes = new Set(REGION_SEEDS.map((r) => r.code));
    for (const r of level2) {
      expect(r.parent, r.code).not.toBeNull();
      expect(allCodes.has(r.parent as string), `${r.code} parent exists`).toBe(true);
      expect(level1Codes.has(r.parent as string), `${r.code} parent is level-1`).toBe(true);
    }
  });

  it('uses lowercase kebab-case codes, level-2 prefixed by the parent code', () => {
    for (const r of REGION_SEEDS) {
      expect(r.code, r.code).toMatch(CODE_PATTERN);
      if (r.parent !== null) {
        expect(r.code.startsWith(`${r.parent}-`), `${r.code} prefix`).toBe(true);
        expect(r.code.length, `${r.code} slug`).toBeGreaterThan(r.parent.length + 1);
      } else {
        expect(r.code, r.code).not.toContain('-');
      }
    }
  });

  it('has non-empty ko/en/uz names', () => {
    for (const r of REGION_SEEDS) {
      expect(r.names.ko.trim(), `${r.code} ko`).not.toBe('');
      expect(r.names.en.trim(), `${r.code} en`).not.toBe('');
      expect(r.names.uz.trim(), `${r.code} uz`).not.toBe('');
    }
  });

  it('has Hangul-only ko names', () => {
    for (const r of REGION_SEEDS) expect(r.names.ko, r.code).toMatch(HANGUL_ONLY);
  });

  it('has en/uz names made only of ASCII letters, hyphens and spaces', () => {
    for (const r of REGION_SEEDS) {
      expect(r.names.en, `${r.code} en`).toMatch(ASCII_NAME);
      expect(r.names.uz, `${r.code} uz`).toMatch(ASCII_NAME);
    }
  });

  it('has no duplicate (parent, ko) pairs', () => {
    const seen = new Set<string>();
    for (const r of REGION_SEEDS) {
      const key = `${r.parent ?? ''}|${r.names.ko}`;
      expect(seen.has(key), `duplicate ${key}`).toBe(false);
      seen.add(key);
    }
  });

  it('has no duplicate (parent, en) pairs', () => {
    const seen = new Set<string>();
    for (const r of REGION_SEEDS) {
      const key = `${r.parent ?? ''}|${r.names.en}`;
      expect(seen.has(key), `duplicate ${key}`).toBe(false);
      seen.add(key);
    }
  });

  it('has unique sortOrder within each parent, starting at 1 without gaps', () => {
    const byParent = new Map<string, number[]>();
    for (const r of REGION_SEEDS) {
      const key = r.parent ?? '';
      const list = byParent.get(key) ?? [];
      list.push(r.sortOrder);
      byParent.set(key, list);
    }
    for (const [parent, orders] of byParent) {
      const sorted = [...orders].sort((a, b) => a - b);
      expect(sorted, `sortOrder of "${parent}"`).toEqual(sorted.map((_, i) => i + 1));
    }
  });

  it('keeps the administrative suffix in en names and the matching ko suffix', () => {
    const suffixes: ReadonlyArray<readonly [string, string]> = [
      ['구', '-gu'],
      ['시', '-si'],
      ['군', '-gun'],
    ];
    for (const r of level2) {
      const pair = suffixes.find(([ko]) => r.names.ko.endsWith(ko));
      expect(pair, `${r.code} ko suffix`).toBeDefined();
      expect(r.names.en.endsWith(pair?.[1] ?? '?'), `${r.code} en suffix`).toBe(true);
    }
  });

  it('spot-checks hard-to-spell districts', () => {
    const find = (code: string) => REGION_SEEDS.find((r) => r.code === code)?.names;
    expect(find('incheon-michuhol')).toEqual({
      ko: '미추홀구',
      en: 'Michuhol-gu',
      uz: 'Michuhol-gu',
    });
    expect(find('daegu-dalseo')).toEqual({ ko: '달서구', en: 'Dalseo-gu', uz: 'Dalseo-gu' });
    expect(find('daegu-gunwi')?.ko).toBe('군위군');
    expect(find('busan-haeundae')?.en).toBe('Haeundae-gu');
    expect(find('busan-gijang')).toEqual({ ko: '기장군', en: 'Gijang-gun', uz: 'Gijang-gun' });
    expect(find('incheon-yeonsu')?.ko).toBe('연수구');
    expect(find('gyeonggi-ansan')?.ko).toBe('안산시');
    expect(find('incheon-ongjin')?.ko).toBe('옹진군');
    expect(find('seoul-gangnam')?.ko).toBe('강남구');
  });
});
