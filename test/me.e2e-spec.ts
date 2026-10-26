import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module.js';
import { closePool } from '../src/db/pool.js';

describe('Auth Profile & Password Change (e2e)', () => {
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

  it('GET /api/v1/auth/me requires Bearer token', async () => {
    // 1. Missing header
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .expect(401);

    // 2. Invalid token
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', 'Bearer invalid-token')
      .expect(401);
  });

  it('GET /api/v1/auth/me rejects tokens with wrong or missing issuer/audience', async () => {
    const secret = app.get(ConfigService).getOrThrow<string>('JWT_SECRET');
    const jwt = new JwtService({ secret });
    const claims = {
      sub: randomUUID(),
      email: `claims-${randomUUID()}@example.com`,
      roles: ['customer'],
    };

    const wrongIssuer = await jwt.signAsync(claims, {
      issuer: 'not-ecom-auth',
      audience: 'ecom-api',
      expiresIn: '15m',
    });
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${wrongIssuer}`)
      .expect(401);

    const wrongAudience = await jwt.signAsync(claims, {
      issuer: 'ecom-auth',
      audience: 'not-ecom-api',
      expiresIn: '15m',
    });
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${wrongAudience}`)
      .expect(401);

    const missingClaims = await jwt.signAsync(claims, { expiresIn: '15m' });
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${missingClaims}`)
      .expect(401);
  });

  it('GET /api/v1/auth/me returns current user profile for valid token', async () => {
    const email = `shopper-${randomUUID()}@example.com`;
    const password = 'Password123';

    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password, firstName: 'Anjali', lastName: 'Mehta' })
      .expect(201);

    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);

    const accessToken = loginRes.body.accessToken;

    const res = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body).toHaveProperty('user');
    expect(res.body.user.email).toBe(email.toLowerCase());
    expect(res.body.user.firstName).toBe('Anjali');
    expect(res.body.user.lastName).toBe('Mehta');
    expect(res.body.user.roles).toContain('customer');
    expect(res.body.user).not.toHaveProperty('password');
    expect(res.body.user).not.toHaveProperty('password_hash');
  });

  it('PATCH /api/v1/auth/me updates user profile', async () => {
    const email = `shopper-${randomUUID()}@example.com`;
    const password = 'Password123';

    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password, firstName: 'Iyer', lastName: 'Scientist' })
      .expect(201);

    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);

    const accessToken = loginRes.body.accessToken;

    const updateRes = await request(app.getHttpServer())
      .patch('/api/v1/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        firstName: 'Subramaniam',
        phone: '+919876543210',
      })
      .expect(200);

    expect(updateRes.body.user.firstName).toBe('Subramaniam');
    expect(updateRes.body.user.lastName).toBe('Scientist');
    expect(updateRes.body.user.phone).toBe('+919876543210');
  });

  it('PATCH /api/v1/auth/me/password updates password and invalidates existing sessions', async () => {
    const email = `shopper-${randomUUID()}@example.com`;
    const oldPassword = 'OldPassword123';
    const newPassword = 'NewPassword456';

    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password: oldPassword, firstName: 'Babita', lastName: 'Iyer' })
      .expect(201);

    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: oldPassword })
      .expect(200);

    const { accessToken, refreshToken } = loginRes.body;

    // 1. Wrong current password -> 401
    await request(app.getHttpServer())
      .patch('/api/v1/auth/me/password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        currentPassword: 'IncorrectOldPassword',
        newPassword,
      })
      .expect(401);

    // 2. Weak new password -> 400
    await request(app.getHttpServer())
      .patch('/api/v1/auth/me/password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        currentPassword: oldPassword,
        newPassword: 'short',
      })
      .expect(400);

    // 3. Successful password change -> 204
    await request(app.getHttpServer())
      .patch('/api/v1/auth/me/password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        currentPassword: oldPassword,
        newPassword,
      })
      .expect(204);

    // 4. Verify existing refresh token is revoked
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken })
      .expect(401);

    // 5. Old password no longer works
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: oldPassword })
      .expect(401);

    // 6. New password works
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: newPassword })
      .expect(200);
  });
});
