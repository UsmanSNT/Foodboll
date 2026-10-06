/**
 * Fills a local database with believable demo data through the public API, so the web app can be
 * explored and screenshotted without hand-entering matches. Development only: it needs the API
 * running with DEV_LOGIN=true.
 *
 *   API_URL=http://localhost:3000 DATABASE_URL=postgres://… pnpm --filter @foodboll/api exec tsx scripts/demo-seed.ts
 */
import pg from 'pg';

const API = process.env.API_URL ?? 'http://localhost:3000';
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('DATABASE_URL is required (used to backdate a few matches)');

async function call<T>(method: string, path: string, token?: string, body?: unknown): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(body !== undefined && { 'content-type': 'application/json' }),
      ...(token && { authorization: `Bearer ${token}` }),
    },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  if (!response.ok)
    throw new Error(`${method} ${path} -> ${response.status} ${await response.text()}`);
  return (await response.json()) as T;
}

interface Session {
  token: string;
  id: string;
}
async function login(name: string, role: 'PLAYER' | 'ORGANIZER' | 'ADMIN'): Promise<Session> {
  const result = await call<{ accessToken: string; user: { id: string } }>(
    'POST',
    '/v1/auth/dev-login',
    undefined,
    { name, role },
  );
  return { token: result.accessToken, id: result.user.id };
}

/** A valid 1×1 PNG: stands in for a receipt screenshot. */
const RECEIPT_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
async function uploadReceipt(registrationId: string, token: string): Promise<void> {
  const response = await fetch(`${API}/v1/registrations/${registrationId}/receipt`, {
    method: 'PUT',
    headers: { 'content-type': 'image/png', authorization: `Bearer ${token}` },
    body: RECEIPT_PNG,
  });
  if (!response.ok)
    throw new Error(`receipt upload -> ${response.status} ${await response.text()}`);
}

const KST = 9 * 3600 * 1000;
/**
 * `daysFromNow` days ahead at `hour:00` Korean time. A start that would already be (almost) over
 * is moved to the next full hour at least two hours from now, so the seed works at any time of day.
 */
function kst(daysFromNow: number, hour: number): Date {
  const base = new Date(Date.now() + KST);
  const day = Date.UTC(
    base.getUTCFullYear(),
    base.getUTCMonth(),
    base.getUTCDate() + daysFromNow,
    hour,
  );
  const wanted = new Date(day - KST);
  const earliest = Date.now() + 2 * 3600 * 1000;
  if (wanted.getTime() >= earliest) return wanted;
  return new Date(Math.ceil(earliest / 3600_000) * 3600_000);
}

interface RegionNode {
  code: string;
  children: RegionNode[];
}
function findCode(tree: RegionNode[], suffix: string): string {
  for (const province of tree) {
    for (const child of province.children) if (child.code.endsWith(`-${suffix}`)) return child.code;
  }
  throw new Error(`No district ending in "${suffix}"`);
}

async function main() {
  const admin = await login('Foodboll Admin', 'ADMIN');
  const tree = (await call<{ items: RegionNode[] }>('GET', '/v1/regions')).items;

  await call('PUT', '/v1/admin/payment-instructions', admin.token, {
    accountNumber: '110-123-456789',
    accountHolder: '김풋볼',
    translations: {
      ko: {
        bankName: '신한은행',
        instructions: '위 계좌로 참가비를 이체하고, 보내는 사람 메모에 결제 코드를 적어주세요.',
      },
      en: {
        bankName: 'Shinhan Bank',
        instructions:
          'Transfer the entry fee to this account and put your payment code in the sender memo.',
      },
      uz: {
        bankName: 'Shinhan Bank',
        instructions:
          'Ishtirok to‘lovini shu hisobga o‘tkazing va jo‘natuvchi izohiga to‘lov kodingizni yozing.',
      },
    },
  });

  const organizers = {
    seoul: await login('Minjun Kim', 'ORGANIZER'),
    ansan: await login('Rustam Aliyev', 'ORGANIZER'),
    busan: await login('Park Jisoo', 'ORGANIZER'),
  };
  const places = {
    gangnam: findCode(tree, 'gangnam'),
    mapo: findCode(tree, 'mapo'),
    ansan: findCode(tree, 'ansan'),
    haeundae: findCode(tree, 'haeundae'),
  };
  await call('PUT', `/v1/admin/users/${organizers.seoul.id}/organizer-regions`, admin.token, {
    regionCodes: ['seoul'],
  });
  await call('PUT', `/v1/admin/users/${organizers.ansan.id}/organizer-regions`, admin.token, {
    regionCodes: ['gyeonggi'],
  });
  await call('PUT', `/v1/admin/users/${organizers.busan.id}/organizer-regions`, admin.token, {
    regionCodes: ['busan'],
  });

  const announce = async (
    who: Session,
    regionCode: string,
    start: Date,
    hours: number,
    venueName: string,
    translations: Record<
      string,
      {
        title: string;
        description?: string;
        locationInstructions?: string;
        equipmentRequirements?: string;
      }
    >,
    options: {
      maxPlayers?: number;
      playersPerSide?: number;
      sourceLanguage?: 'ko' | 'uz' | 'en';
    } = {},
  ) =>
    call<{ id: string }>('POST', '/v1/matches', who.token, {
      sourceLanguage: options.sourceLanguage ?? 'ko',
      regionCode,
      startsAt: start.toISOString(),
      endsAt: new Date(start.getTime() + hours * 3600 * 1000).toISOString(),
      venueName,
      playersPerSide: options.playersPerSide ?? 6,
      maxPlayers: options.maxPlayers ?? 18,
      translations,
    });

  const m1 = await announce(
    organizers.seoul,
    places.gangnam,
    kst(2, 22),
    2,
    '강남 풋살파크 A구장',
    {
      ko: {
        title: '강남 금요 나이트 풋살',
        description: '초보도 환영! 가볍게 뛰어요.',
        locationInstructions: '2번 출구에서 도보 5분. 건물 지하 1층 입구로 오세요.',
        equipmentRequirements: '풋살화, 정강이 보호대, 물',
      },
      en: {
        title: 'Gangnam Friday night futsal',
        description: 'Beginners welcome. Come and have a run.',
        locationInstructions: 'Exit 2, five minutes on foot. Use the basement-level entrance.',
        equipmentRequirements: 'Futsal shoes, shin guards, water',
      },
      uz: {
        title: 'Gangnam juma kechasi futzal',
        description: 'Yangi boshlovchilar ham xush kelibsiz!',
      },
    },
  );
  const m2 = await announce(
    organizers.seoul,
    places.mapo,
    kst(0, 20),
    2,
    '마포 하늘공원 구장',
    {
      ko: { title: '마포 퇴근 후 축구' },
      en: { title: 'Mapo after-work football' },
    },
    { playersPerSide: 7, maxPlayers: 14 },
  );
  const m3 = await announce(
    organizers.ansan,
    places.ansan,
    kst(3, 19),
    2,
    '안산 와스타디움 보조구장',
    {
      ko: { title: '안산 외국인 친구들 축구', description: '다양한 나라 사람들과 함께 뛰어요.' },
      en: {
        title: 'Ansan international friends football',
        description: 'Play with people from many countries.',
      },
      uz: {
        title: 'Ansan xalqaro do‘stlar futboli',
        description: 'Turli mamlakatlardan kelgan do‘stlar bilan o‘ynaymiz.',
      },
    },
    { sourceLanguage: 'uz', maxPlayers: 22, playersPerSide: 11 },
  );
  const m4 = await announce(
    organizers.busan,
    places.haeundae,
    kst(5, 18),
    2,
    '해운대 해변 구장',
    {
      ko: { title: '해운대 선셋 풋살' },
      en: { title: 'Haeundae sunset futsal' },
    },
    { maxPlayers: 12 },
  );
  const old1 = await announce(
    organizers.seoul,
    places.gangnam,
    kst(1, 21),
    2,
    '강남 풋살파크 B구장',
    { ko: { title: '강남 목요 풋살' }, en: { title: 'Gangnam Thursday futsal' } },
  );
  const old2 = await announce(organizers.seoul, places.mapo, kst(1, 19), 2, '마포 하늘공원 구장', {
    ko: { title: '마포 주말 축구' },
    en: { title: 'Mapo weekend football' },
  });

  const names = [
    'Aziz Karimov',
    'Dilnoza Yusupova',
    'Sunwoo Lee',
    'Emma Johnson',
    'Bobur Rakhimov',
    'Nguyen Van An',
    'Carlos Mendes',
    'Aigerim Sadykova',
    'Hamza Ali',
    'Yuki Tanaka',
    'Ivan Petrov',
    'Sardor Tursunov',
  ];
  const players: Session[] = [];
  for (const name of names) players.push(await login(name, 'PLAYER'));

  const registerAndPay = async (match: { id: string }, who: Session[], pay: number) => {
    let paid = 0;
    for (const player of who) {
      const registration = await call<{ id: string }>(
        'POST',
        `/v1/matches/${match.id}/registrations`,
        player.token,
      );
      if (paid++ < pay) {
        await uploadReceipt(registration.id, player.token);
        await call(
          'POST',
          `/v1/admin/registrations/${registration.id}/payment/confirm`,
          admin.token,
        );
      }
    }
  };
  await registerAndPay(m1, players.slice(0, 9), 8);
  await registerAndPay(m2, players.slice(2, 12), 10);
  await registerAndPay(m3, players.slice(0, 5), 5);
  await registerAndPay(m4, players.slice(6, 11), 3);
  await registerAndPay(old1, players.slice(0, 6), 6);
  await registerAndPay(old2, players.slice(0, 4), 4);

  // Move two matches into the past and mark attendance, so profiles and levels have something to show.
  const db = new pg.Client({ connectionString: DATABASE_URL });
  await db.connect();
  for (const id of [old1.id, old2.id]) {
    await db.query(
      "update matches set starts_at = starts_at - interval '9 days', ends_at = ends_at - interval '9 days' where id = $1",
      [id],
    );
  }
  await db.end();
  for (const [match, who] of [
    [old1, organizers.seoul],
    [old2, organizers.seoul],
  ] as const) {
    const roster = await call<{ items: { registrationId: string }[] }>(
      'GET',
      `/v1/matches/${match.id}/roster`,
      who.token,
    );
    await call('PUT', `/v1/matches/${match.id}/attendance`, who.token, {
      marks: roster.items.map((entry, index) => ({
        registrationId: entry.registrationId,
        attended: index !== 3,
      })),
    });
  }

  console.log(
    JSON.stringify(
      {
        admin: 'Foodboll Admin',
        organizers: ['Minjun Kim', 'Rustam Aliyev', 'Park Jisoo'],
        players: names,
      },
      null,
      2,
    ),
  );
}

await main();
