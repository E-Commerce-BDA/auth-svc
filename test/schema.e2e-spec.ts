import { randomUUID } from 'node:crypto';
import { PoolClient } from 'pg';
import { closePool, getPool } from '../src/db/pool.js';

if (!process.env.DATABASE_URL && typeof process.loadEnvFile === 'function') {
  process.loadEnvFile();
}

describe('Schema (e2e)', () => {
  let client: PoolClient;

  beforeAll(async () => {
    client = await getPool().connect();
    await client.query('BEGIN');
  });

  afterAll(async () => {
    if (client) {
      await client.query('ROLLBACK');
      client.release();
    }
    await closePool();
  });

  it('1. 7 base tables exist in auth schema', async () => {
    const { rows } = await client.query<{ table_name: string }>(
      `SELECT table_name 
       FROM information_schema.tables 
       WHERE table_schema = 'auth' AND table_type = 'BASE TABLE'
       ORDER BY table_name;`,
    );

    const tableNames = rows.map((r) => r.table_name);
    expect(tableNames).toEqual([
      'addresses',
      'permissions',
      'refresh_tokens',
      'role_permissions',
      'roles',
      'user_roles',
      'users',
    ]);
  });

  it('2. all required indexes exist by name', async () => {
    const { rows } = await client.query<{ indexname: string }>(
      `SELECT indexname 
       FROM pg_indexes 
       WHERE schemaname = 'auth';`,
    );

    const indexNames = rows.map((r) => r.indexname);
    const expectedIndexes = [
      'idx_users_status',
      'idx_addresses_user_id',
      'one_default_per_user',
      'idx_refresh_tokens_user_id',
      'idx_refresh_tokens_family_id',
      'idx_refresh_tokens_expires_at',
      'idx_role_permissions_permission_id',
      'idx_user_roles_role_id',
      'users_email_key',
      'refresh_tokens_token_hash_key',
    ];

    expect(indexNames).toEqual(expect.arrayContaining(expectedIndexes));
  });

  it('3. PK defaults produce UUIDs, status defaults active, timestamps default non-null', async () => {
    const email = `test-${randomUUID()}@example.com`;
    const { rows } = await client.query<{
      id: string;
      status: string;
      created_at: Date;
      updated_at: Date;
    }>(
      `INSERT INTO auth.users (email, password_hash, first_name, last_name)
       VALUES ($1, 'hashed_pw', 'Alice', 'Smith')
       RETURNING id, status, created_at, updated_at;`,
      [email],
    );

    const user = rows[0];
    expect(user.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(user.status).toBe('active');
    expect(user.created_at).toBeDefined();
    expect(user.updated_at).toBeDefined();
  });

  it('4. trigger bumps updated_at, leaves created_at alone', async () => {
    const email = `test-${randomUUID()}@example.com`;
    const pastTimestamp = '2000-01-01T00:00:00Z';

    const insertResult = await client.query<{ id: string }>(
      `INSERT INTO auth.users (email, password_hash, first_name, last_name, created_at, updated_at)
       VALUES ($1, 'hashed_pw', 'Bob', 'Jones', $2, $2)
       RETURNING id;`,
      [email, pastTimestamp],
    );
    const userId = insertResult.rows[0].id;

    const updateResult = await client.query<{
      created_at: Date;
      updated_at: Date;
    }>(
      `UPDATE auth.users
       SET first_name = 'Robert'
       WHERE id = $1
       RETURNING created_at, updated_at;`,
      [userId],
    );

    const updated = updateResult.rows[0];
    expect(new Date(updated.created_at).toISOString()).toBe(
      new Date(pastTimestamp).toISOString(),
    );
    expect(new Date(updated.updated_at).getTime()).toBeGreaterThan(
      new Date(pastTimestamp).getTime(),
    );
  });

  it('5. uppercase email rejected', async () => {
    await client.query('SAVEPOINT sp5');
    try {
      await expect(
        client.query(
          `INSERT INTO auth.users (email, password_hash, first_name, last_name)
           VALUES ('UPPERCASE@EXAMPLE.COM', 'hashed_pw', 'Upper', 'Case');`,
        ),
      ).rejects.toMatchObject({
        code: '23514',
        constraint: 'users_email_lowercase_check',
      });
    } finally {
      await client.query('ROLLBACK TO SAVEPOINT sp5');
    }
  });

  it('6. duplicate email rejected', async () => {
    const email = `test-${randomUUID()}@example.com`;
    await client.query(
      `INSERT INTO auth.users (email, password_hash, first_name, last_name)
       VALUES ($1, 'hashed_pw', 'First', 'User');`,
      [email],
    );

    await client.query('SAVEPOINT sp6');
    try {
      await expect(
        client.query(
          `INSERT INTO auth.users (email, password_hash, first_name, last_name)
           VALUES ($1, 'hashed_pw', 'Second', 'User');`,
          [email],
        ),
      ).rejects.toMatchObject({
        code: '23505',
        constraint: 'users_email_key',
      });
    } finally {
      await client.query('ROLLBACK TO SAVEPOINT sp6');
    }
  });

  it('7. duplicate role slug rejected', async () => {
    const slug = `role-${randomUUID().slice(0, 8)}`;
    await client.query(
      `INSERT INTO auth.roles (name, slug, description)
       VALUES ('Custom Role', $1, 'A test role');`,
      [slug],
    );

    await client.query('SAVEPOINT sp7');
    try {
      await expect(
        client.query(
          `INSERT INTO auth.roles (name, slug, description)
           VALUES ('Another Role', $1, 'Duplicate slug test');`,
          [slug],
        ),
      ).rejects.toMatchObject({
        code: '23505',
        constraint: 'roles_slug_key',
      });
    } finally {
      await client.query('ROLLBACK TO SAVEPOINT sp7');
    }
  });

  it('8. deleting a user removes addresses, refresh tokens, user_roles', async () => {
    const email = `test-${randomUUID()}@example.com`;
    const userRes = await client.query<{ id: string }>(
      `INSERT INTO auth.users (email, password_hash, first_name, last_name)
       VALUES ($1, 'hashed_pw', 'Parent', 'User')
       RETURNING id;`,
      [email],
    );
    const userId = userRes.rows[0].id;

    // insert address
    await client.query(
      `INSERT INTO auth.addresses (user_id, line1, city, postal_code)
       VALUES ($1, '123 Main St', 'Cityville', '12345');`,
      [userId],
    );

    // insert refresh_token
    await client.query(
      `INSERT INTO auth.refresh_tokens (user_id, family_id, token_hash, expires_at)
       VALUES ($1, $2, $3, now() + interval '30 days');`,
      [userId, randomUUID(), `hash-${randomUUID()}`],
    );

    // insert user_role
    const roleRes = await client.query<{ id: string }>(
      `SELECT id FROM auth.roles WHERE slug = 'customer' LIMIT 1;`,
    );
    const roleId = roleRes.rows[0].id;
    await client.query(
      `INSERT INTO auth.user_roles (user_id, role_id)
       VALUES ($1, $2);`,
      [userId, roleId],
    );

    // Delete user
    await client.query(`DELETE FROM auth.users WHERE id = $1;`, [userId]);

    // Check counts
    const addrCount = await client.query(
      `SELECT count(*) FROM auth.addresses WHERE user_id = $1;`,
      [userId],
    );
    const tokenCount = await client.query(
      `SELECT count(*) FROM auth.refresh_tokens WHERE user_id = $1;`,
      [userId],
    );
    const roleCount = await client.query(
      `SELECT count(*) FROM auth.user_roles WHERE user_id = $1;`,
      [userId],
    );

    expect(Number(addrCount.rows[0].count)).toBe(0);
    expect(Number(tokenCount.rows[0].count)).toBe(0);
    expect(Number(roleCount.rows[0].count)).toBe(0);
  });

  it('9. deleting a permission/role removes join rows', async () => {
    const roleRes = await client.query<{ id: string }>(
      `INSERT INTO auth.roles (name, slug)
       VALUES ('Temporary Role', $1)
       RETURNING id;`,
      [`temp-role-${randomUUID().slice(0, 8)}`],
    );
    const roleId = roleRes.rows[0].id;

    const permRes = await client.query<{ id: string }>(
      `INSERT INTO auth.permissions (name, slug)
       VALUES ('Temporary Permission', $1)
       RETURNING id;`,
      [`temp-perm-${randomUUID().slice(0, 8)}`],
    );
    const permId = permRes.rows[0].id;

    // Join
    await client.query(
      `INSERT INTO auth.role_permissions (role_id, permission_id)
       VALUES ($1, $2);`,
      [roleId, permId],
    );

    // Delete role -> removes join row
    await client.query(`DELETE FROM auth.roles WHERE id = $1;`, [roleId]);
    const check1 = await client.query(
      `SELECT count(*) FROM auth.role_permissions WHERE role_id = $1;`,
      [roleId],
    );
    expect(Number(check1.rows[0].count)).toBe(0);

    // Re-create role & join, then delete permission
    const roleRes2 = await client.query<{ id: string }>(
      `INSERT INTO auth.roles (name, slug)
       VALUES ('Temporary Role 2', $1)
       RETURNING id;`,
      [`temp-role-2-${randomUUID().slice(0, 8)}`],
    );
    const roleId2 = roleRes2.rows[0].id;

    await client.query(
      `INSERT INTO auth.role_permissions (role_id, permission_id)
       VALUES ($1, $2);`,
      [roleId2, permId],
    );

    await client.query(`DELETE FROM auth.permissions WHERE id = $1;`, [permId]);
    const check2 = await client.query(
      `SELECT count(*) FROM auth.role_permissions WHERE permission_id = $1;`,
      [permId],
    );
    expect(Number(check2.rows[0].count)).toBe(0);
  });

  it('10. refresh_tokens has no updated_at', async () => {
    const { rows } = await client.query<{ column_name: string }>(
      `SELECT column_name 
       FROM information_schema.columns 
       WHERE table_schema = 'auth' AND table_name = 'refresh_tokens';`,
    );

    const columns = rows.map((r) => r.column_name);
    expect(columns).toContain('created_at');
    expect(columns).not.toContain('updated_at');
  });

  it('11. second default address rejected', async () => {
    const email = `test-${randomUUID()}@example.com`;
    const userRes = await client.query<{ id: string }>(
      `INSERT INTO auth.users (email, password_hash, first_name, last_name)
       VALUES ($1, 'hashed_pw', 'Address', 'User')
       RETURNING id;`,
      [email],
    );
    const userId = userRes.rows[0].id;

    // First default address succeeds
    await client.query(
      `INSERT INTO auth.addresses (user_id, line1, city, postal_code, is_default)
       VALUES ($1, 'Default Address 1', 'Cityville', '12345', true);`,
      [userId],
    );

    await client.query('SAVEPOINT sp11');
    try {
      await expect(
        client.query(
          `INSERT INTO auth.addresses (user_id, line1, city, postal_code, is_default)
           VALUES ($1, 'Default Address 2', 'Cityville', '12345', true);`,
          [userId],
        ),
      ).rejects.toMatchObject({
        code: '23505',
        constraint: 'one_default_per_user',
      });
    } finally {
      await client.query('ROLLBACK TO SAVEPOINT sp11');
    }
  });
});
