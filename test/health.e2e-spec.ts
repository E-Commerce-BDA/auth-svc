import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { closePool } from './../src/db/pool.js';

describe('Health (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/health (GET) reports liveness without database details', async () => {
    const response = await request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect({ status: 'ok' });

    expect(Object.keys(response.body)).toEqual(['status']);
  });

  it('/health/ready (GET) reports the database as up', async () => {
    const response = await request(app.getHttpServer())
      .get('/health/ready')
      .expect(200)
      .expect({ status: 'ready', checks: { db: 'up' } });

    expect(response.body).not.toHaveProperty('password');
    expect(response.body).not.toHaveProperty('databaseUrl');
  });

  afterAll(async () => {
    await app.close();
    // The pool is a module-level singleton: nothing in the Nest lifecycle owns
    // it, so an open pool keeps the event loop alive and hangs the test run.
    await closePool();
  });
});
