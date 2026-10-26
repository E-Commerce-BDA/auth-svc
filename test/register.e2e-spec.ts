import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module.js';
import { closePool } from '../src/db/pool.js';

describe('Auth Register (e2e)', () => {
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

  it('POST /api/v1/auth/register creates a user and returns 201', async () => {
    const email = `shopper-${randomUUID()}@example.com`;
    const payload = {
      email,
      password: 'securePassword123',
      firstName: 'Jethalal',
      lastName: 'Gada',
    };

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send(payload)
      .expect(201);

    expect(response.body).toHaveProperty('user');
    expect(response.body.user).toBeDefined();
    expect(response.body.user.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(response.body.user.email).toBe(email.toLowerCase());
    expect(response.body.user.firstName).toBe('Jethalal');
    expect(response.body.user.lastName).toBe('Gada');
    expect(response.body.user).not.toHaveProperty('password');
    expect(response.body.user).not.toHaveProperty('password_hash');
  });

  it('POST /api/v1/auth/register rejects duplicate email with 409 Conflict', async () => {
    const email = `duplicate-${randomUUID()}@example.com`;
    const payload = {
      email,
      password: 'securePassword123',
      firstName: 'Champak',
      lastName: 'Gada',
    };

    // First registration succeeds
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send(payload)
      .expect(201);

    // Second registration with the same email (even with uppercase letters) fails with 409
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        ...payload,
        email: email.toUpperCase(),
      })
      .expect(409);

    expect(response.body.error).toMatchObject({
      code: 'CONFLICT',
    });
    expect(response.body.error.message).toContain('Email already exists');
    expect(response.body.requestId).toEqual(expect.any(String));
    expect(response.body.timestamp).toEqual(expect.any(String));
  });

  it('POST /api/v1/auth/register returns 400 when password violates policy', async () => {
    const payload = {
      email: `valid-${randomUUID()}@example.com`,
      password: 'weak', // Violates min length (8) and regex (must have letter + number)
      firstName: 'Tipendra',
      lastName: 'Gada',
    };

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send(payload)
      .expect(400);

    expect(response.body.error).toMatchObject({
      code: 'VALIDATION_FAILED',
      message: 'Validation failed',
    });
    expect(Array.isArray(response.body.error.details)).toBe(true);
    expect(response.body.requestId).toEqual(expect.any(String));
    expect(response.body.timestamp).toEqual(expect.any(String));
  });

  it('POST /api/v1/auth/register returns 400 when email is invalid', async () => {
    const payload = {
      email: 'not-a-valid-email',
      password: 'securePassword123',
      firstName: 'Tipendra',
      lastName: 'Gada',
    };

    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send(payload)
      .expect(400);
  });
});