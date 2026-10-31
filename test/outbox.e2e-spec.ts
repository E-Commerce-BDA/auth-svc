import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import {
  eventEnvelopeSchema,
  parseEventEnvelope,
  type EventEnvelope,
  type EventTopic,
} from '@ecom/contracts';
import {
  OutboxRelay,
  RecordingLogger,
  RecordingPublisher,
  type OutboxStorePort,
  type OutboxWriteInput,
  type Queryable,
} from '@ecom/messaging';
import { OUTBOX_PUBLISHER, OUTBOX_RELAY, OUTBOX_STORE } from '@ecom/messaging/nest';
import { AppModule } from '../src/app.module.js';
import { closePool, getPool } from '../src/db/pool.js';

if (!process.env.DATABASE_URL && typeof process.loadEnvFile === 'function') {
  process.loadEnvFile();
}

interface OutboxRecord {
  id: string;
  event_id: string;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  envelope: EventEnvelope;
  status: string;
  attempts: number;
  last_error: string | null;
  locked_until: Date | null;
  published_at: Date | null;
}

async function rowsFor(aggregateId: string): Promise<OutboxRecord[]> {
  const { rows } = await getPool().query<OutboxRecord>(
    `SELECT id, event_id, aggregate_type, aggregate_id, event_type, envelope,
            status, attempts, last_error, locked_until, published_at
       FROM auth.outbox
      WHERE aggregate_id = $1
      ORDER BY created_at, id`,
    [aggregateId],
  );

  return rows;
}

/** Pretend the retry backoff elapsed, so the next drain can claim the row. */
async function expireLease(rowId: string): Promise<void> {
  await getPool().query(
    `UPDATE auth.outbox SET locked_until = now() - interval '1 second' WHERE id = $1`,
    [rowId],
  );
}

/**
 * The relay claims whichever rows are pending, and spec files run in parallel
 * against one database. Cases that count attempts therefore narrow the store to
 * a single aggregate, so a concurrently registered user cannot consume an
 * attempt. The claim limit is raised because rows left by other suites are
 * claimed first and then filtered away; `leaseSeconds: 0` keeps them claimable.
 */
function onlyAggregate(
  store: OutboxStorePort,
  aggregateId: string,
  limit = 200,
): OutboxStorePort {
  return {
    write: <T extends EventTopic>(client: Queryable, input: OutboxWriteInput<T>) =>
      store.write(client, input),
    claimBatch: async (_limit, leaseSeconds) => {
      const rows = await store.claimBatch(limit, leaseSeconds);
      return rows.filter((row) => row.aggregate_id === aggregateId);
    },
    markPublished: (id) => store.markPublished(id),
    markFailed: (id, error, maxAttempts, backoffSeconds) =>
      store.markFailed(id, error, maxAttempts, backoffSeconds),
    tryAcquireRelayLock: () => store.tryAcquireRelayLock(),
  };
}

describe('Auth outbox (e2e)', () => {
  let app: INestApplication;
  let store: OutboxStorePort;
  let moduleRelay: OutboxRelay;
  let publisher: RecordingPublisher;
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    publisher = new RecordingPublisher();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(OUTBOX_PUBLISHER)
      .useValue(publisher)
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1', { exclude: ['health', 'health/ready'] });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    store = moduleFixture.get<OutboxStorePort>(OUTBOX_STORE);
    moduleRelay = moduleFixture.get<OutboxRelay>(OUTBOX_RELAY);
  });

  afterAll(async () => {
    await app.close();
    if (createdUserIds.length > 0) {
      await getPool().query(
        'DELETE FROM auth.outbox WHERE aggregate_id = ANY($1::uuid[])',
        [createdUserIds],
      );
    }
    await closePool();
  });

  beforeEach(() => {
    publisher.reset();
  });

  async function register(
    firstName = 'Alice',
    lastName = 'Smith',
  ): Promise<{ email: string; userId: string }> {
    const email = `outbox-${randomUUID()}@example.com`;

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password: 'securePassword123', firstName, lastName })
      .expect(201);

    const userId = response.body.user.id as string;
    createdUserIds.push(userId);

    return { email, userId };
  }

  it('writes exactly one user.registered row in the registration transaction', async () => {
    const { userId } = await register();
    const rows = await rowsFor(userId);

    expect(rows).toHaveLength(1);

    const [row] = rows;
    expect(row).toMatchObject({
      aggregate_type: 'user',
      aggregate_id: userId,
      event_type: 'user.registered',
      status: 'pending',
      attempts: 0,
      last_error: null,
      locked_until: null,
      published_at: null,
    });

    expect(eventEnvelopeSchema.safeParse(row!.envelope).success).toBe(true);
    expect(row!.envelope).toMatchObject({
      id: row!.event_id,
      type: 'user.registered',
      topic: 'user.registered',
      eventType: 'user.registered',
      version: 1,
      producer: 'auth-svc',
      idempotencyKey: row!.event_id,
    });

    const payload = parseEventEnvelope('user.registered', row!.envelope);
    expect(payload).toMatchObject({
      userId,
      displayName: 'Alice Smith',
      registeredAt: row!.envelope.timestamp,
    });
    // PII rule: the id and a display name, never the email address.
    expect(JSON.stringify(row!.envelope.payload)).not.toContain('@');
  });

  it('rolls the outbox row back when the registration conflicts', async () => {
    const { email, userId } = await register('Champak', 'Gada');

    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email,
        password: 'securePassword123',
        firstName: 'Champak',
        lastName: 'Gada',
      })
      .expect(409);

    // The only user with this address is the first one, and it owns one event.
    expect(await rowsFor(userId)).toHaveLength(1);

    // The rolled-back attempt's row would have outlived its user; none may exist.
    const { rows } = await getPool().query<{ count: string }>(
      `SELECT count(*) FROM auth.outbox o
        WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = o.aggregate_id)`,
    );
    expect(Number(rows[0]!.count)).toBe(0);
  });

  it('publishes the stored envelope, keyed by userId, and marks the row published', async () => {
    const { userId } = await register();

    // Scoped so this file never claims rows another spec file left pending.
    const relay = new OutboxRelay({
      store: onlyAggregate(store, userId),
      publisher,
      logger: new RecordingLogger(),
    });

    await relay.drainOnce();

    const [row] = await rowsFor(userId);
    expect(row!.status).toBe('published');
    expect(row!.published_at).toBeInstanceOf(Date);
    expect(row!.locked_until).toBeNull();

    const published = publisher.published.filter(
      (entry) => entry.key === userId,
    );
    expect(published).toHaveLength(1);
    expect(published[0]!.topic).toBe('user.registered');
    expect(published[0]!.envelope).toEqual(row!.envelope);
  });

  it('records a failed attempt and republishes once the backoff elapses', async () => {
    const { userId } = await register();
    const [row] = await rowsFor(userId);

    const relay = new OutboxRelay({
      store: onlyAggregate(store, userId),
      publisher,
      logger: new RecordingLogger(),
      leaseSeconds: 0,
      maxAttempts: 5,
    });

    publisher.failNext = 1;
    const failed = await relay.drainOnce();
    expect(failed).toMatchObject({ published: 0, failed: 1, skipped: false });

    const [afterFailure] = await rowsFor(userId);
    expect(afterFailure!.status).toBe('pending');
    expect(afterFailure!.attempts).toBe(1);
    expect(afterFailure!.last_error).toContain('unavailable');
    expect(afterFailure!.locked_until).toBeInstanceOf(Date);
    expect(afterFailure!.published_at).toBeNull();

    await expireLease(row!.id);
    const retried = await relay.drainOnce();
    expect(retried).toMatchObject({ published: 1, failed: 0, skipped: false });

    const [published] = await rowsFor(userId);
    expect(published!.status).toBe('published');
    expect(published!.attempts).toBe(1);
    expect(published!.last_error).toBeNull();
    expect(publisher.published.filter((entry) => entry.key === userId)).toHaveLength(1);
  });

  it('parks the row as failed after five attempts and never retries it', async () => {
    const { userId } = await register();
    const [row] = await rowsFor(userId);

    const relay = new OutboxRelay({
      store: onlyAggregate(store, userId),
      publisher,
      logger: new RecordingLogger(),
      leaseSeconds: 0,
      maxAttempts: 5,
    });

    publisher.failNext = 5;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      if (attempt > 0) {
        // The previous attempt set a backoff on the lease.
        await expireLease(row!.id);
      }
      const result = await relay.drainOnce();
      // A drain that claimed nothing would leave the row short of five attempts.
      expect(result.failed).toBe(1);
    }

    const [parked] = await rowsFor(userId);
    expect(parked!.status).toBe('failed');
    expect(parked!.attempts).toBe(5);
    expect(parked!.locked_until).toBeNull();
    expect(parked!.last_error).toBeTruthy();

    const sixth = await relay.drainOnce();
    expect(sixth.published).toBe(0);

    const [stillParked] = await rowsFor(userId);
    expect(stillParked!.attempts).toBe(5);
    expect(stillParked!.status).toBe('failed');
    expect(publisher.published.filter((entry) => entry.key === userId)).toHaveLength(0);
  });

  it('publishes nothing while another worker holds the relay lock', async () => {
    const { userId } = await register();

    const holder = await getPool().connect();
    try {
      const { rows } = await holder.query<{ locked: boolean }>(
        "SELECT pg_try_advisory_lock(hashtextextended('auth.outbox', 0)) AS locked",
      );
      expect(rows[0]!.locked).toBe(true);

      const result = await moduleRelay.drainOnce();

      expect(result).toEqual({ published: 0, failed: 0, skipped: true });

      const [untouched] = await rowsFor(userId);
      expect(untouched!.status).toBe('pending');
      expect(untouched!.locked_until).toBeNull();
      expect(untouched!.attempts).toBe(0);
      expect(publisher.published.filter((entry) => entry.key === userId)).toHaveLength(0);
    } finally {
      await holder.query(
        "SELECT pg_advisory_unlock(hashtextextended('auth.outbox', 0))",
      );
      holder.release();
    }
  });

  it('rejects a row whose envelope disagrees with its columns', async () => {
    const { userId } = await register();
    const [row] = await rowsFor(userId);

    // Two checks protect the row: the type registry and the envelope agreement.
    await expect(
      getPool().query(
        `UPDATE auth.outbox
            SET event_type = 'cart.updated'
          WHERE id = $1`,
        [row!.id],
      ),
    ).rejects.toMatchObject({ code: '23514' });

    await expect(
      getPool().query(
        `INSERT INTO auth.outbox
           (event_id, aggregate_type, aggregate_id, event_type, envelope)
         VALUES ($1, 'user', $2, 'user.registered', $3::jsonb)`,
        [
          randomUUID(),
          userId,
          JSON.stringify({ ...row!.envelope, id: randomUUID() }),
        ],
      ),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'outbox_envelope_id_matches',
    });
  });
});
