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
