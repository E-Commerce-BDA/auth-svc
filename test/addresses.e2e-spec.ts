import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module.js';
import { closePool } from '../src/db/pool.js';

describe('Auth Address Book (e2e)', () => {
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

  it('handles address CRUD and enforces single default address per user', async () => {
    const email = `shopper-${randomUUID()}@example.com`;
    const password = 'Password123';

    // 1. Register & Login
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password, firstName: 'Roshan', lastName: 'Singh' })
      .expect(201);

    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);

    const token = loginRes.body.accessToken;

    // 2. Create first address as default
    const addr1Res = await request(app.getHttpServer())
      .post('/api/v1/auth/me/addresses')
      .set('Authorization', `Bearer ${token}`)
      .send({
        label: 'Home',
        line1: 'Gokuldham Society',
        city: 'Mumbai',
        state: 'Maharashtra',
        postalCode: '400001',
        isDefault: true,
      })
      .expect(201);

    const addr1Id = addr1Res.body.address.id;
    expect(addr1Res.body.address.is_default).toBe(true);

    // 3. Create second address ALSO as default
    const addr2Res = await request(app.getHttpServer())
      .post('/api/v1/auth/me/addresses')
      .set('Authorization', `Bearer ${token}`)
      .send({
        label: 'Office',
        line1: 'Bandra Kurla Complex',
        city: 'Mumbai',
        state: 'Maharashtra',
        postalCode: '400051',
        isDefault: true,
      })
      .expect(201);

    const addr2Id = addr2Res.body.address.id;
    expect(addr2Res.body.address.is_default).toBe(true);

    // 4. List addresses: addr2 must be default (true), addr1 must now be false!
    const listRes = await request(app.getHttpServer())
      .get('/api/v1/auth/me/addresses')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(listRes.body.addresses.length).toBe(2);
    const addr1InList = listRes.body.addresses.find((a: any) => a.id === addr1Id);
    const addr2InList = listRes.body.addresses.find((a: any) => a.id === addr2Id);

    expect(addr1InList.is_default).toBe(false);
    expect(addr2InList.is_default).toBe(true);

    // 5. Update addr1 line2
    const updateRes = await request(app.getHttpServer())
      .patch(`/api/v1/auth/me/addresses/${addr1Id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ line2: 'Flat 101, A Wing' })
      .expect(200);

    expect(updateRes.body.address.line2).toBe('Flat 101, A Wing');

    // 6. Delete addr1
    await request(app.getHttpServer())
      .delete(`/api/v1/auth/me/addresses/${addr1Id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(204);

    // 7. Verify only 1 address remains
    const finalList = await request(app.getHttpServer())
      .get('/api/v1/auth/me/addresses')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(finalList.body.addresses.length).toBe(1);
    expect(finalList.body.addresses[0].id).toBe(addr2Id);
  });
});
