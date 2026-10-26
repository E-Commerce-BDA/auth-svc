import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module.js';
import { closePool, getPool } from '../src/db/pool.js';

describe('Auth Admin RBAC & User Management (e2e)', () => {
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

  it('enforces RBAC: customers receive 403 Forbidden on admin endpoints', async () => {
    const email = `customer-${randomUUID()}@example.com`;
    const password = 'Password123';

    // 1. Register customer
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password, firstName: 'Goli', lastName: 'Hathi' })
      .expect(201);

    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);

    const customerToken = loginRes.body.accessToken;

    // 2. Customer attempts to list users -> 403 Forbidden
    const forbidden = await request(app.getHttpServer())
      .get('/api/v1/auth/users')
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(403);

    expect(forbidden.body.error).toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(forbidden.body.requestId).toEqual(expect.any(String));
    expect(forbidden.body.timestamp).toEqual(expect.any(String));

    // 3. Customer attempts to create role -> 403 Forbidden
    await request(app.getHttpServer())
      .post('/api/v1/auth/roles')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ name: 'Manager', slug: 'manager' })
      .expect(403);
  });

  it('allows admins to list users, change status, and manage roles', async () => {
    const adminEmail = `admin-${randomUUID()}@example.com`;
    const targetEmail = `target-${randomUUID()}@example.com`;
    const password = 'Password123';

    // 1. Register both users
    const adminReg = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: adminEmail, password, firstName: 'Admin', lastName: 'Boss' })
      .expect(201);

    const targetReg = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: targetEmail, password, firstName: 'Target', lastName: 'User' })
      .expect(201);

    const adminUserId = adminReg.body.user.id;
    const targetUserId = targetReg.body.user.id;

    // 2. Promote adminUser in DB to 'admin' role
    const client = await getPool().connect();
    try {
      const adminRoleRes = await client.query("SELECT id FROM auth.roles WHERE slug = 'admin'");
      const adminRoleId = adminRoleRes.rows[0].id;
      await client.query(
        'INSERT INTO auth.user_roles(user_id, role_id) VALUES($1, $2) ON CONFLICT DO NOTHING',
        [adminUserId, adminRoleId],
      );
    } finally {
      client.release();
    }

    // 3. Login as admin to get token with 'admin' role
    const adminLoginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: adminEmail, password })
      .expect(200);

    const adminToken = adminLoginRes.body.accessToken;
    expect(adminLoginRes.body.user.roles).toContain('admin');

    // 4. Admin lists users
    const listRes = await request(app.getHttpServer())
      .get('/api/v1/auth/users?page=1&perPage=10')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(listRes.body).toHaveProperty('data');
    expect(listRes.body).toHaveProperty('total');
    expect(Array.isArray(listRes.body.data)).toBe(true);

    // 5. Admin creates a new role
    const newRoleSlug = `support-${randomUUID().slice(0, 8)}`;
    const roleRes = await request(app.getHttpServer())
      .post('/api/v1/auth/roles')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Support Agent',
        slug: newRoleSlug,
        description: 'Customer support staff',
      })
      .expect(201);

    expect(roleRes.body.role.slug).toBe(newRoleSlug);

    // 6. Admin assigns the new role to target user
    const assignRes = await request(app.getHttpServer())
      .patch(`/api/v1/auth/users/${targetUserId}/roles`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        roleSlugs: ['customer', newRoleSlug],
      })
      .expect(200);

    expect(assignRes.body.userRoles).toContain(newRoleSlug);

    // 7. Admin disables target user
    const statusRes = await request(app.getHttpServer())
      .patch(`/api/v1/auth/users/${targetUserId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'disabled' })
      .expect(200);

    expect(statusRes.body.user.status).toBe('disabled');

    // 8. Verify target user is now refused login with 401
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: targetEmail, password })
      .expect(401);
  });
});
