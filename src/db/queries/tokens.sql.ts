import { Pool, PoolClient } from 'pg';
import { RefreshTokenRow } from '../rows.js';

type pgClient = Pool | PoolClient;

export async function createRefreshToken(
  client: pgClient,
  params: {
    id: string;
    userId: string;
    familyId: string;
    tokenHash: string;
    expiresAt: Date;
  },
): Promise<RefreshTokenRow> {
  const INSERT_TOKEN = `
    INSERT INTO auth.refresh_tokens(
      id,
      user_id,
      family_id,
      token_hash,
      expires_at
    )
    VALUES(
      $1,
      $2,
      $3,
      $4,
      $5
    )
    RETURNING id,
      user_id,
      family_id,
      token_hash,
      expires_at,
      created_at,
      revoked_at
  `;
  const res = await client.query(INSERT_TOKEN, [
    params.id,
    params.userId,
    params.familyId,
    params.tokenHash,
    params.expiresAt,
  ]);
  return res.rows[0];
}

export async function findRefreshTokenByHash(
  client: pgClient,
  params: { tokenHash: string },
): Promise<RefreshTokenRow | null> {
  const FIND_TOKEN = `
    SELECT id, user_id, family_id, token_hash, expires_at, created_at, revoked_at
    FROM auth.refresh_tokens
    WHERE token_hash = $1
  `;
  const res = await client.query(FIND_TOKEN, [params.tokenHash]);
  return res.rows[0] ?? null;
}

export async function revokeRefreshToken(
  client: pgClient,
  params: { tokenId: string },
): Promise<void> {
  const REVOKE_TOKEN = `
    UPDATE auth.refresh_tokens
    SET revoked_at = now()
    WHERE id = $1
  `;
  await client.query(REVOKE_TOKEN, [params.tokenId]);
}

export async function revokeTokenFamily(
  client: pgClient,
  params: { familyId: string },
): Promise<void> {
  const REVOKE_FAMILY = `
    UPDATE auth.refresh_tokens
    SET revoked_at = now()
    WHERE family_id = $1 AND revoked_at IS NULL
  `;
  await client.query(REVOKE_FAMILY, [params.familyId]);
}

export async function revokeAllUserTokens(
  client: pgClient,
  params: { userId: string },
): Promise<void> {
  const REVOKE_ALL = `
    UPDATE auth.refresh_tokens
    SET revoked_at = now()
    WHERE user_id = $1 AND revoked_at IS NULL
  `;
  await client.query(REVOKE_ALL, [params.userId]);
}

export async function findActiveFamilyToken(
  client: pgClient,
  params: { familyId: string },
): Promise<RefreshTokenRow | null> {
  const FIND_ACTIVE = `
    SELECT id, user_id, family_id, token_hash, expires_at, created_at, revoked_at
    FROM auth.refresh_tokens
    WHERE family_id = $1 AND revoked_at IS NULL AND expires_at > now()
    ORDER BY created_at DESC
    LIMIT 1
  `;
  const res = await client.query(FIND_ACTIVE, [params.familyId]);
  return res.rows[0] ?? null;
}
