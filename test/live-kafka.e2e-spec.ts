import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { Kafka, type Consumer } from 'kafkajs';
import request from 'supertest';
import { App } from 'supertest/types.js';
import {
  parseEventEnvelope,
  readEventEnvelope,
  type CanonicalEventEnvelope,
} from '@ecom/contracts';
import {
  KafkaEventPublisher,
  OutboxRelay,
  RecordingLogger,
  type EventTopic,
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

const RUN_ID = randomUUID().slice(0, 8);
const RUN_LIVE = process.env.RUN_KAFKA_E2E === '1';

function brokers(): string[] {
  return (process.env.KAFKA_BROKERS ?? 'localhost:9092')
    .split(',')
    .map((broker) => broker.trim())
    .filter(Boolean);
}

interface CapturedMessage {
  key: string | null;
  value: string;
}

interface OutboxRecord {
  event_id: string;
  envelope: unknown;
  status: string;
  published_at: Date | null;
}

async function rowsFor(userId: string): Promise<OutboxRecord[]> {
  const { rows } = await getPool().query<OutboxRecord>(
    `SELECT event_id, envelope, status, published_at
       FROM auth.outbox
      WHERE aggregate_id = $1
      ORDER BY created_at, id`,
    [userId],
  );

  return rows;
}

describe.runIf(RUN_LIVE)('user.registered over a real broker (live)', () => {
  let app: INestApplication<App>;
  let publisher: KafkaEventPublisher;
  let relay: OutboxRelay;
  let store: OutboxStorePort;
  let consumer: Consumer;

  const createdUserIds: string[] = [];
  const captured: CapturedMessage[] = [];

  beforeAll(async () => {
    await assertBrokerReady('user.registered');

    publisher = new KafkaEventPublisher({
      brokers,
      clientId: `auth-svc-live-${RUN_ID}`,
    });

    const moduleFixture = await Test.createTestingModule({
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

    relay = moduleFixture.get<OutboxRelay>(OUTBOX_RELAY);
    store = moduleFixture.get<OutboxStorePort>(OUTBOX_STORE);

    // Subscribe before producing: `fromBeginning: false` only sees new records.
    const kafka = new Kafka({
      clientId: `auth-svc-live-consumer-${RUN_ID}`,
      brokers: brokers(),
      connectionTimeout: 5000,
    });
    consumer = kafka.consumer({ groupId: `auth-svc-live-${RUN_ID}` });
    await consumer.connect();
    await consumer.subscribe({ topic: 'user.registered', fromBeginning: false });
    await consumer.run({
      eachMessage: async ({ message }) => {
        captured.push({
          key: message.key?.toString() ?? null,
          value: message.value?.toString() ?? '',
        });
      },
    });

    // The group join is asynchronous; give it a moment before producing.
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }, 60_000);

  afterAll(async () => {
    if (consumer) {
      await consumer.disconnect();
    }

    if (createdUserIds.length > 0) {
      await getPool().query(
        'DELETE FROM auth.outbox WHERE aggregate_id = ANY($1::uuid[])',
        [createdUserIds],
      );
    }

    if (relay) {
      relay.stop();
    }

    if (publisher) {
      await publisher.close();
    }

    if (app) {
      await app.close();
    }
    await closePool();
  }, 60_000);

  it('publishes one user.registered keyed by userId, with no email in the payload', async () => {
    const email = `live-${RUN_ID}-${randomUUID()}@example.com`;

    const registered = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email,
        password: 'securePassword123',
        firstName: 'Alice',
        lastName: 'Smith',
      })
      .expect(201);

    const userId = registered.body.user.id as string;
    createdUserIds.push(userId);

    const [row] = await rowsFor(userId);
    expect(row!.status).toBe('pending');

    await drainUntilPublished(userId);

    const message = await waitFor(
      () => captured.find((entry) => entry.key === userId),
      15_000,
      `no user.registered record keyed ${userId} on the topic`,
    );

    expect(message.key).toBe(userId);

    const envelope: CanonicalEventEnvelope = readEventEnvelope(
      JSON.parse(message.value),
    );
    expect(envelope.type).toBe('user.registered');
    expect(envelope.producer).toBe('auth-svc');
    expect(envelope.version).toBe(1);
    expect(envelope.idempotencyKey).toBe(envelope.id);
    expect(envelope.id).toBe(row!.event_id);

    const payload = parseEventEnvelope('user.registered', envelope);
    expect(payload.userId).toBe(userId);
    expect(payload.displayName).toBe('Alice Smith');
    // PII rule: the id and a display name, never the email address.
    expect(payload).not.toHaveProperty('email');
    expect(JSON.stringify(payload)).not.toContain('@');
    expect(JSON.stringify(payload)).not.toContain(email);

    const [published] = await rowsFor(userId);
    expect(published!.status).toBe('published');
    expect(published!.published_at).toBeInstanceOf(Date);
  }, 60_000);

  /**
   * Publish the pending rows of this user only.
   *
   * The store is scoped to one aggregate so a live run never claims — and sends
   * to the real broker — a row that another spec file left pending in the shared
   * database.
   */
  async function drainUntilPublished(target: string): Promise<void> {
    const scoped = new OutboxRelay({
      store: onlyUser(store, target),
      publisher,
      logger: new RecordingLogger(),
    });

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const rows = await rowsFor(target);
      if (rows.every((row) => row.status === 'published')) {
        return;
      }
      await scoped.drainOnce();
    }

    throw new Error(`relay did not publish user ${target}`);
  }
});

/** Narrow the store to one aggregate id, for a shared test database. */
function onlyUser(
  store: OutboxStorePort,
  userId: string,
  limit = 200,
): OutboxStorePort {
  return {
    write: <T extends EventTopic>(
      client: Queryable,
      input: OutboxWriteInput<T>,
    ) => store.write(client, input),
    claimBatch: async (_limit, leaseSeconds) => {
      const rows = await store.claimBatch(limit, leaseSeconds);
      return rows.filter((row) => row.aggregate_id === userId);
    },
    markPublished: (id) => store.markPublished(id),
    markFailed: (id, error, maxAttempts, backoffSeconds) =>
      store.markFailed(id, error, maxAttempts, backoffSeconds),
    tryAcquireRelayLock: () => store.tryAcquireRelayLock(),
  };
}

/** Fail with an actionable message rather than a kafkajs timeout. */
async function assertBrokerReady(topic: string): Promise<void> {
  const admin = new Kafka({
    clientId: `auth-svc-live-admin-${RUN_ID}`,
    brokers: brokers(),
    connectionTimeout: 5000,
  }).admin();
  const endpoint = brokers().join(', ');

  try {
    await admin.connect();
  } catch (error) {
    throw new Error(
      `ecom-kafka is not reachable at ${endpoint} (${
        (error as Error).message
      }). Start it with \`docker compose up -d ecom-kafka\`.`,
    );
  }

  try {
    const topics = await admin.listTopics();
    if (!topics.includes(topic)) {
      throw new Error(
        `topic '${topic}' is missing at ${endpoint}. Provision it with ` +
          '`ecom-infra/scripts/provision-topics.mjs`.',
      );
    }
  } finally {
    await admin.disconnect();
  }
}

async function waitFor<T>(
  probe: () => T | undefined,
  timeoutMs: number,
  failure: string,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const found = probe();
    if (found !== undefined) {
      return found;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  throw new Error(failure);
}
