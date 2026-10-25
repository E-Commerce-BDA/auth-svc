import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module.js';
import { closePool, getPool } from '../src/db/pool.js';

describe('Auth Refresh & Logout (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1', {
      exclude: ['health', 'health/ready'],
    });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await closePool();
  });

  it('POST /api/v1/auth/refresh rotates the token and returns 200 with new tokens', async () => {
    const email = `shopper-${randomUUID()}@example.com`;
    const password = 'Password123';

    // 1. Register and login
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password, firstName: 'Bhide', lastName: 'Master' })
      .expect(201);

    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);

    const originalRefreshToken = loginRes.body.refreshToken;

    // 2. Perform refresh
    const refreshRes = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: originalRefreshToken })
      .expect(200);

    expect(refreshRes.body).toHaveProperty('accessToken');
    expect(refreshRes.body).toHaveProperty('refreshToken');
    expect(refreshRes.body.refreshToken).not.toBe(originalRefreshToken);

    // 3. The new refresh token works for another refresh
    const nextRefreshRes = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: refreshRes.body.refreshToken })
      .expect(200);

    expect(nextRefreshRes.body).toHaveProperty('accessToken');
    expect(nextRefreshRes.body).toHaveProperty('refreshToken');
  });

  it('POST /api/v1/auth/refresh handles multi-tab concurrent refresh within 10s grace period', async () => {
    const email = `shopper-${randomUUID()}@example.com`;
    const password = 'Password123';

    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password, firstName: 'Madhavi', lastName: 'Bhide' })
      .expect(201);

    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);

    const token = loginRes.body.refreshToken;

    // Tab 1 refreshes
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: token })
      .expect(200);

    // Tab 2 sends the exact same old token within 1 second (<10s grace period)
    const secondCall = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: token })
      .expect(200);

    expect(secondCall.body).toHaveProperty('accessToken');
  });

  it('POST /api/v1/auth/refresh revokes entire family when reused after grace window (theft detection)', async () => {
    const email = `shopper-${randomUUID()}@example.com`;
    const password = 'Password123';

    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password, firstName: 'Sonu', lastName: 'Bhide' })
      .expect(201);

    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);

    const firstToken = loginRes.body.refreshToken;

    // 1. Legitimate refresh creates secondToken
    const refreshRes = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: firstToken })
      .expect(200);

    const secondToken = refreshRes.body.refreshToken;

    // 2. Simulate time passage (>10s): backdate the revoked_at of firstToken to 20 seconds ago
    const client = await getPool().connect();
    try {
      await client.query(
        "UPDATE auth.refresh_tokens SET revoked_at = now() - interval '20 seconds' WHERE revoked_at IS NOT NULL",
      );
    } finally {
      client.release();
    }

    // 3. Attacker replays firstToken
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: firstToken })
      .expect(401);

    // 4. Now the legitimate user's secondToken must ALSO be revoked (family destroyed)
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: secondToken })
      .expect(401);
  });

  it('POST /api/v1/auth/logout revokes the token and returns 204', async () => {
    const email = `shopper-${randomUUID()}@example.com`;
    const password = 'Password123';

    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password, firstName: 'Abdul', lastName: 'Soda' })
      .expect(201);

    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);

    const token = loginRes.body.refreshToken;

    // Logout
    await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .send({ refreshToken: token })
      .expect(204);

    // Logging out again is safe and idempotent
    await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .send({ refreshToken: token })
      .expect(204);
  });
});
