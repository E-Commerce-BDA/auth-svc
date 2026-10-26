import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module.js';
import { closePool } from '../src/db/pool.js';

describe('Auth Login (e2e)', () => {
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

  it('POST /api/v1/auth/login returns 200 with user, accessToken, and refreshToken', async () => {
    const email = `shopper-${randomUUID()}@example.com`;
    const password = 'Password123';

    // 1. Register user first
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email,
        password,
        firstName: 'Daya',
        lastName: 'Gada',
      })
      .expect(201);

    // 2. Login
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        email,
        password,
      })
      .expect(200);

    expect(response.body).toHaveProperty('user');
    expect(response.body).toHaveProperty('accessToken');
    expect(response.body).toHaveProperty('refreshToken');

    // Verify user object
    expect(response.body.user.email).toBe(email.toLowerCase());
    expect(response.body.user.firstName).toBe('Daya');
    expect(response.body.user.lastName).toBe('Gada');
    expect(response.body.user.roles).toContain('customer');
    expect(response.body.user).not.toHaveProperty('password');
    expect(response.body.user).not.toHaveProperty('password_hash');

    // Verify token formats
    const parts = response.body.accessToken.split('.');
    expect(parts.length).toBe(3); // JWT format (header.payload.signature)

    const payload = JSON.parse(
      Buffer.from(parts[1], 'base64url').toString('utf8'),
    ) as { iss?: string; aud?: string };
    expect(payload.iss).toBe('ecom-auth');
    expect(payload.aud).toBe('ecom-api');

    expect(typeof response.body.refreshToken).toBe('string');
    expect(response.body.refreshToken.length).toBe(64); // 32 hex bytes
  });

  it('POST /api/v1/auth/login is case-insensitive for email', async () => {
    const email = `shopper-${randomUUID()}@example.com`;
    const password = 'Password123';

    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email,
        password,
        firstName: 'Taarak',
        lastName: 'Mehta',
      })
      .expect(201);

    // Login with uppercase email
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        email: email.toUpperCase(),
        password,
      })
      .expect(200);

    expect(response.body.user.email).toBe(email.toLowerCase());
  });

  it('POST /api/v1/auth/login rejects incorrect password with 401', async () => {
    const email = `shopper-${randomUUID()}@example.com`;

    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email,
        password: 'Password123',
        firstName: 'Popatlal',
        lastName: 'Pandey',
      })
      .expect(201);

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        email,
        password: 'WrongPassword999',
      })
      .expect(401);

    expect(response.body.message).toBe('Invalid email or password');
  });

  it('POST /api/v1/auth/login rejects non-existent email with identical 401', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        email: `doesnotexist-${randomUUID()}@example.com`,
        password: 'Password123',
      })
      .expect(401);

    expect(response.body.message).toBe('Invalid email or password');
  });

  it('POST /api/v1/auth/login returns 400 when email format is invalid', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        email: 'invalid-email',
        password: 'Password123',
      })
      .expect(400);
  });

  it('POST /api/v1/auth/login returns 400 when password is empty', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        email: `shopper-${randomUUID()}@example.com`,
        password: '',
      })
      .expect(400);
  });
});
