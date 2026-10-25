import { Pool, PoolClient } from "pg";
import { RoleRow, UserRow } from "../rows.js";

type pgClient = Pool | PoolClient

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
    const CREATE_USER = `
    INSERT INTO auth.users(id, email, password_hash, first_name, last_name)
    VALUES($1, $2, $3, $4, $5)
    RETURNING id, email, password_hash, first_name, last_name, phone, avatar_url, status, last_login_at, created_at, updated_at
    `
    const res = await client.query(CREATE_USER, [
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
        userId: string
        roleId: string
    }
): Promise<void> {
    const ASSIGN_ROLE = `
    INSERT INTO auth.user_roles(user_id, role_id)
    VALUES($1, $2)
    `
    await client.query(ASSIGN_ROLE, [params.userId, params.roleId])
}

export async function findUserByEmail(
    client: pgClient,
    params: {
        email: string
    }
): Promise<UserRow | null> {
    const FIND_USER = `
    SELECT id, email, password_hash, first_name, last_name, status
    FROM auth.users 
    WHERE email = $1
    `
    const res = await client.query(FIND_USER, [params.email])
    return res.rows[0] ?? null
}

export async function findUserById(
    client: pgClient,
    params: {
        id: string
    }
): Promise<UserRow | null> {
    const FIND_USER = `
    SELECT id, email, password_hash, first_name, last_name, status
    FROM auth.users 
    WHERE id = $1
    `
    const res = await client.query(FIND_USER, [params.id])
    return res.rows[0] ?? null
}

export async function getUserRoleSlugs(
    client: pgClient,
    params: {
        userId: string
    }
): Promise<string[]> {
    const FIND_ROLES = `
    SELECT r.slug
    FROM auth.users u
    JOIN auth.user_roles ur ON ur.user_id = u.id
    JOIN auth.roles r ON r.id = ur.role_id
    WHERE u.id = $1
    `
    const res = await client.query(FIND_ROLES, [params.userId])
    return res.rows.map((row) => row.slug)
}
