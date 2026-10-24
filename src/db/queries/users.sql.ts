import { Pool, PoolClient } from 'pg';
import { UserRow, RoleRow } from '../rows.js';

type pgClient = Pool | PoolClient;

export async function createUser(
    client: pgClient,
    params: {
        id: string
        email: string
        passwordHash: string
        firstName: string
        lastName: string
    }
): Promise<UserRow> {
    const INSERT_USER = `
    INSERT INTO auth.users(
        id, email, password_hash, first_name, last_name)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *
    `
    const res = await client.query(INSERT_USER, [
        params.id,
        params.email,
        params.passwordHash,
        params.firstName,
        params.lastName,
    ])
    return res.rows[0]
}

export async function findRoleBySlug(
    client: pgClient,
    params: {
        slug: string
    }
): Promise<RoleRow | null> {
    const FIND_ROLE = `
    SELECT * FROM auth.roles WHERE slug = $1
    `
    const res = await client.query(FIND_ROLE, [params.slug])
    return res.rows[0] ?? null
}

export async function assignUserRole(
    client: pgClient,
    params: {
        userId: string,
        roleId: string
    }
): Promise<void> {
    const ASSIGN_ROLE = `
    INSERT INTO auth.user_roles(user_id, role_id)
    VALUES($1, $2)
    `
    await client.query(ASSIGN_ROLE, [params.userId, params.roleId])
}
