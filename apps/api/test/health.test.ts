import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { createDb, type DbHandle } from '../src/db/client';
import { startTestApp, TEST_CONFIG, type TestContext } from './helpers';

describe('health endpoint', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await startTestApp();
  });
  afterAll(() => ctx.close());

  it('reports ok while the database answers, without authentication or rate limits', async () => {
    for (let i = 0; i < 3; i += 1) {
      const res = await ctx.app.inject({ method: 'GET', url: '/health' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: 'ok' });
    }
  });
});

describe('health endpoint with the database unreachable', () => {
  let handle: DbHandle;
  let app: ReturnType<typeof buildApp>;
  beforeAll(async () => {
    // Port 1 refuses connections immediately, so the check fails fast.
    handle = createDb('postgres://foodboll:foodboll@127.0.0.1:1/foodboll', {
      onError: () => undefined,
    });
    app = buildApp(TEST_CONFIG('postgres://foodboll:foodboll@127.0.0.1:1/foodboll'), handle.db);
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    await handle.close();
  });

  it('answers 503 without exposing the connection error', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: 'unavailable' });
    expect(res.body).not.toMatch(/ECONNREFUSED|127\.0\.0\.1|foodboll:foodboll/);
  });
});
