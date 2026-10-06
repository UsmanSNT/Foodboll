/**
 * Reference data: Korean administrative regions used to route football matches.
 *
 * Level 1 = province / metropolitan city (17). Level 2 = district / city / county.
 *
 * Rules:
 * - `code` is a stable, URL-safe id and must never change once published.
 *   Level-1: 'seoul'. Level-2: '<parentCode>-<slug>' (e.g. 'busan-haeundae').
 *   The parent prefix keeps shared district names (중구, 동구, 서구, ...) unique.
 * - Level-1 `ko` names use the short everyday form people actually say (서울, 경기, 충북).
 * - Level-2 `ko` names are the standard official form (강남구, 안산시, 옹진군).
 * - `en` is Revised Romanization with the administrative suffix kept (Gangnam-gu).
 * - `uz` (Latin script) mirrors `en`, except Seoul -> 'Seul'. This is deliberately
 *   conservative; a native speaker should review it.
 * - Cities with general districts (일반구), e.g. 수원시, are listed as the city only.
 * - Outside the metropolitan areas and Gyeonggi, only cities/counties with a large
 *   foreign-resident / football community are listed. Add more later, never renumber codes.
 */

export interface RegionSeed {
  /** Stable, URL-safe, lowercase kebab-case id. Level-1: 'seoul'. Level-2: '<parentCode>-<slug>', e.g. 'seoul-gangnam', 'gyeonggi-ansan', 'busan-haeundae'. Never change once published. */
  readonly code: string;
  /** parent code, or null for level-1 */
  readonly parent: string | null;
  /** order within its parent; level-1 in the order below */
  readonly sortOrder: number;
  readonly names: { readonly ko: string; readonly en: string; readonly uz: string };
}

/** [slug, ko, en] — `uz` mirrors `en` for level-2 entries. */
type ChildRow = readonly [slug: string, ko: string, en: string];

interface ProvinceRow {
  readonly code: string;
  readonly ko: string;
  readonly en: string;
  readonly uz: string;
  readonly children: readonly ChildRow[];
}

const PROVINCES: readonly ProvinceRow[] = [
  {
    code: 'seoul',
    ko: '서울',
    en: 'Seoul',
    uz: 'Seul',
    children: [
      ['jongno', '종로구', 'Jongno-gu'],
      ['jung', '중구', 'Jung-gu'],
      ['yongsan', '용산구', 'Yongsan-gu'],
      ['seongdong', '성동구', 'Seongdong-gu'],
      ['gwangjin', '광진구', 'Gwangjin-gu'],
      ['dongdaemun', '동대문구', 'Dongdaemun-gu'],
      ['jungnang', '중랑구', 'Jungnang-gu'],
      ['seongbuk', '성북구', 'Seongbuk-gu'],
      ['gangbuk', '강북구', 'Gangbuk-gu'],
      ['dobong', '도봉구', 'Dobong-gu'],
      ['nowon', '노원구', 'Nowon-gu'],
      ['eunpyeong', '은평구', 'Eunpyeong-gu'],
      ['seodaemun', '서대문구', 'Seodaemun-gu'],
      ['mapo', '마포구', 'Mapo-gu'],
      ['yangcheon', '양천구', 'Yangcheon-gu'],
      ['gangseo', '강서구', 'Gangseo-gu'],
      ['guro', '구로구', 'Guro-gu'],
      ['geumcheon', '금천구', 'Geumcheon-gu'],
      ['yeongdeungpo', '영등포구', 'Yeongdeungpo-gu'],
      ['dongjak', '동작구', 'Dongjak-gu'],
      ['gwanak', '관악구', 'Gwanak-gu'],
      ['seocho', '서초구', 'Seocho-gu'],
      ['gangnam', '강남구', 'Gangnam-gu'],
      ['songpa', '송파구', 'Songpa-gu'],
      ['gangdong', '강동구', 'Gangdong-gu'],
    ],
  },
  {
    code: 'busan',
    ko: '부산',
    en: 'Busan',
    uz: 'Busan',
    children: [
      ['jung', '중구', 'Jung-gu'],
      ['seo', '서구', 'Seo-gu'],
      ['dong', '동구', 'Dong-gu'],
      ['yeongdo', '영도구', 'Yeongdo-gu'],
      ['busanjin', '부산진구', 'Busanjin-gu'],
      ['dongnae', '동래구', 'Dongnae-gu'],
      ['nam', '남구', 'Nam-gu'],
      ['buk', '북구', 'Buk-gu'],
      ['haeundae', '해운대구', 'Haeundae-gu'],
      ['saha', '사하구', 'Saha-gu'],
      ['geumjeong', '금정구', 'Geumjeong-gu'],
      ['gangseo', '강서구', 'Gangseo-gu'],
      ['yeonje', '연제구', 'Yeonje-gu'],
      ['suyeong', '수영구', 'Suyeong-gu'],
      ['sasang', '사상구', 'Sasang-gu'],
      ['gijang', '기장군', 'Gijang-gun'],
    ],
  },
  {
    code: 'daegu',
    ko: '대구',
    en: 'Daegu',
    uz: 'Daegu',
    children: [
      ['jung', '중구', 'Jung-gu'],
      ['dong', '동구', 'Dong-gu'],
      ['seo', '서구', 'Seo-gu'],
      ['nam', '남구', 'Nam-gu'],
      ['buk', '북구', 'Buk-gu'],
      ['suseong', '수성구', 'Suseong-gu'],
      ['dalseo', '달서구', 'Dalseo-gu'],
      ['dalseong', '달성군', 'Dalseong-gun'],
      ['gunwi', '군위군', 'Gunwi-gun'],
    ],
  },
  {
    code: 'incheon',
    ko: '인천',
    en: 'Incheon',
    uz: 'Incheon',
    children: [
      // Since 2026-07-01: Jung-gu + Dong-gu merged into Jemulpo-gu, Yeongjong split
      // from Jung-gu, Seo-gu split into Seohae-gu and Geomdan-gu (2 gun + 9 gu).
      ['jemulpo', '제물포구', 'Jemulpo-gu'],
      ['yeongjong', '영종구', 'Yeongjong-gu'],
      ['michuhol', '미추홀구', 'Michuhol-gu'],
      ['yeonsu', '연수구', 'Yeonsu-gu'],
      ['namdong', '남동구', 'Namdong-gu'],
      ['bupyeong', '부평구', 'Bupyeong-gu'],
      ['gyeyang', '계양구', 'Gyeyang-gu'],
      ['seohae', '서해구', 'Seohae-gu'],
      ['geomdan', '검단구', 'Geomdan-gu'],
      ['ganghwa', '강화군', 'Ganghwa-gun'],
      ['ongjin', '옹진군', 'Ongjin-gun'],
    ],
  },
  {
    code: 'gwangju',
    ko: '광주',
    en: 'Gwangju',
    uz: 'Gwangju',
    children: [
      ['dong', '동구', 'Dong-gu'],
      ['seo', '서구', 'Seo-gu'],
      ['nam', '남구', 'Nam-gu'],
      ['buk', '북구', 'Buk-gu'],
      ['gwangsan', '광산구', 'Gwangsan-gu'],
    ],
  },
  {
    code: 'daejeon',
    ko: '대전',
    en: 'Daejeon',
    uz: 'Daejeon',
    children: [
      ['dong', '동구', 'Dong-gu'],
      ['jung', '중구', 'Jung-gu'],
      ['seo', '서구', 'Seo-gu'],
      ['yuseong', '유성구', 'Yuseong-gu'],
      ['daedeok', '대덕구', 'Daedeok-gu'],
    ],
  },
  {
    code: 'ulsan',
    ko: '울산',
    en: 'Ulsan',
    uz: 'Ulsan',
    children: [
      ['jung', '중구', 'Jung-gu'],
      ['nam', '남구', 'Nam-gu'],
      ['dong', '동구', 'Dong-gu'],
      ['buk', '북구', 'Buk-gu'],
      ['ulju', '울주군', 'Ulju-gun'],
    ],
  },
  {
    code: 'sejong',
    ko: '세종',
    en: 'Sejong',
    uz: 'Sejong',
    children: [],
  },
  {
    code: 'gyeonggi',
    ko: '경기',
    en: 'Gyeonggi',
    uz: 'Gyeonggi',
    children: [
      ['suwon', '수원시', 'Suwon-si'],
      ['seongnam', '성남시', 'Seongnam-si'],
      ['uijeongbu', '의정부시', 'Uijeongbu-si'],
      ['anyang', '안양시', 'Anyang-si'],
      ['bucheon', '부천시', 'Bucheon-si'],
      ['gwangmyeong', '광명시', 'Gwangmyeong-si'],
      ['pyeongtaek', '평택시', 'Pyeongtaek-si'],
      ['dongducheon', '동두천시', 'Dongducheon-si'],
      ['ansan', '안산시', 'Ansan-si'],
      ['goyang', '고양시', 'Goyang-si'],
      ['gwacheon', '과천시', 'Gwacheon-si'],
      ['guri', '구리시', 'Guri-si'],
      ['namyangju', '남양주시', 'Namyangju-si'],
      ['osan', '오산시', 'Osan-si'],
      ['siheung', '시흥시', 'Siheung-si'],
      ['gunpo', '군포시', 'Gunpo-si'],
      ['uiwang', '의왕시', 'Uiwang-si'],
      ['hanam', '하남시', 'Hanam-si'],
      ['yongin', '용인시', 'Yongin-si'],
      ['paju', '파주시', 'Paju-si'],
      ['icheon', '이천시', 'Icheon-si'],
      ['anseong', '안성시', 'Anseong-si'],
      ['gimpo', '김포시', 'Gimpo-si'],
      ['hwaseong', '화성시', 'Hwaseong-si'],
      ['gwangju', '광주시', 'Gwangju-si'],
      ['yangju', '양주시', 'Yangju-si'],
      ['pocheon', '포천시', 'Pocheon-si'],
      ['yeoju', '여주시', 'Yeoju-si'],
      ['yeoncheon', '연천군', 'Yeoncheon-gun'],
      ['gapyeong', '가평군', 'Gapyeong-gun'],
      ['yangpyeong', '양평군', 'Yangpyeong-gun'],
    ],
  },
  {
    code: 'gangwon',
    ko: '강원',
    en: 'Gangwon',
    uz: 'Gangwon',
    children: [
      ['chuncheon', '춘천시', 'Chuncheon-si'],
      ['wonju', '원주시', 'Wonju-si'],
      ['gangneung', '강릉시', 'Gangneung-si'],
      ['sokcho', '속초시', 'Sokcho-si'],
      ['donghae', '동해시', 'Donghae-si'],
    ],
  },
  {
    code: 'chungbuk',
    ko: '충북',
    en: 'Chungbuk',
    uz: 'Chungbuk',
    children: [
      ['cheongju', '청주시', 'Cheongju-si'],
      ['chungju', '충주시', 'Chungju-si'],
      ['jecheon', '제천시', 'Jecheon-si'],
      ['eumseong', '음성군', 'Eumseong-gun'],
      ['jincheon', '진천군', 'Jincheon-gun'],
      ['jeungpyeong', '증평군', 'Jeungpyeong-gun'],
    ],
  },
  {
    code: 'chungnam',
    ko: '충남',
    en: 'Chungnam',
    uz: 'Chungnam',
    children: [
      ['cheonan', '천안시', 'Cheonan-si'],
      ['asan', '아산시', 'Asan-si'],
      ['gongju', '공주시', 'Gongju-si'],
      ['seosan', '서산시', 'Seosan-si'],
      ['dangjin', '당진시', 'Dangjin-si'],
      ['nonsan', '논산시', 'Nonsan-si'],
      ['boryeong', '보령시', 'Boryeong-si'],
    ],
  },
  {
    code: 'jeonbuk',
    ko: '전북',
    en: 'Jeonbuk',
    uz: 'Jeonbuk',
    children: [
      ['jeonju', '전주시', 'Jeonju-si'],
      ['gunsan', '군산시', 'Gunsan-si'],
      ['iksan', '익산시', 'Iksan-si'],
      ['jeongeup', '정읍시', 'Jeongeup-si'],
      ['namwon', '남원시', 'Namwon-si'],
      ['gimje', '김제시', 'Gimje-si'],
      ['wanju', '완주군', 'Wanju-gun'],
    ],
  },
  {
    code: 'jeonnam',
    ko: '전남',
    en: 'Jeonnam',
    uz: 'Jeonnam',
    children: [
      ['mokpo', '목포시', 'Mokpo-si'],
      ['yeosu', '여수시', 'Yeosu-si'],
      ['suncheon', '순천시', 'Suncheon-si'],
      ['gwangyang', '광양시', 'Gwangyang-si'],
      ['naju', '나주시', 'Naju-si'],
      ['muan', '무안군', 'Muan-gun'],
    ],
  },
  {
    code: 'gyeongbuk',
    ko: '경북',
    en: 'Gyeongbuk',
    uz: 'Gyeongbuk',
    children: [
      ['pohang', '포항시', 'Pohang-si'],
      ['gumi', '구미시', 'Gumi-si'],
      ['gyeongju', '경주시', 'Gyeongju-si'],
      ['gimcheon', '김천시', 'Gimcheon-si'],
      ['andong', '안동시', 'Andong-si'],
      ['yeongju', '영주시', 'Yeongju-si'],
      ['gyeongsan', '경산시', 'Gyeongsan-si'],
      ['chilgok', '칠곡군', 'Chilgok-gun'],
    ],
  },
  {
    code: 'gyeongnam',
    ko: '경남',
    en: 'Gyeongnam',
    uz: 'Gyeongnam',
    children: [
      ['changwon', '창원시', 'Changwon-si'],
      ['gimhae', '김해시', 'Gimhae-si'],
      ['yangsan', '양산시', 'Yangsan-si'],
      ['jinju', '진주시', 'Jinju-si'],
      ['geoje', '거제시', 'Geoje-si'],
      ['sacheon', '사천시', 'Sacheon-si'],
      ['miryang', '밀양시', 'Miryang-si'],
    ],
  },
  {
    code: 'jeju',
    ko: '제주',
    en: 'Jeju',
    uz: 'Jeju',
    children: [
      ['jeju', '제주시', 'Jeju-si'],
      ['seogwipo', '서귀포시', 'Seogwipo-si'],
    ],
  },
];

export const REGION_SEEDS: readonly RegionSeed[] = PROVINCES.flatMap(
  (province, provinceIndex): RegionSeed[] => [
    {
      code: province.code,
      parent: null,
      sortOrder: provinceIndex + 1,
      names: { ko: province.ko, en: province.en, uz: province.uz },
    },
    ...province.children.map(([slug, ko, en], childIndex): RegionSeed => ({
      code: `${province.code}-${slug}`,
      parent: province.code,
      sortOrder: childIndex + 1,
      names: { ko, en, uz: en },
    })),
  ],
);
