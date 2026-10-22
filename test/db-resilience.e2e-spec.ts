import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { closePool, getPool } from './../src/db/pool.js';

// Regression guard: a server-side connection termination (database restart,
// admin terminate, failover) makes pg-pool emit an 'error' event on the pool.
// Node throws on unhandled 'error' events, so without a listener the whole
// service process dies on the next database blip.
describe('Database resilience (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('survives a terminated database connection and keeps serving', async () => {
    const { rows } = await getPool().query<{ pid: number }>(
      'SELECT pg_backend_pid() AS pid',
    );
    const victimPid = rows[0].pid;

    const admin = new Client({ connectionString: process.env.DATABASE_URL });
    await admin.connect();
    await admin.query('SELECT pg_terminate_backend($1)', [victimPid]);
    await admin.end();

    // Give the pool a moment to observe the dropped connection.
    await new Promise((resolve) => setTimeout(resolve, 500));

    // The process must still be alive and serving: the pool drops the dead
    // client and opens a fresh one for the next query.
    await request(app.getHttpServer()).get('/health').expect(200);
  });

  afterAll(async () => {
    await app.close();
    await closePool();
  });
});
