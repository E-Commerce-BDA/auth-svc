import { Pool, PoolClient } from 'pg';
import { AddressRow } from '../rows.js';

type pgClient = Pool | PoolClient;

export async function getUserAddresses(
  client: pgClient,
  params: { userId: string },
): Promise<AddressRow[]> {
  const GET_ADDRESSES = `
    SELECT id, user_id, type, label, line1, line2, city, state, postal_code, country, is_default, created_at, updated_at
    FROM auth.addresses
    WHERE user_id = $1
    ORDER BY is_default DESC, created_at DESC
  `;
  const res = await client.query(GET_ADDRESSES, [params.userId]);
  return res.rows;
}

export async function findAddressByIdAndUser(
  client: pgClient,
  params: { id: string; userId: string },
): Promise<AddressRow | null> {
  const FIND_ADDRESS = `
    SELECT id, user_id, type, label, line1, line2, city, state, postal_code, country, is_default, created_at, updated_at
    FROM auth.addresses
    WHERE id = $1 AND user_id = $2
  `;
  const res = await client.query(FIND_ADDRESS, [params.id, params.userId]);
  return res.rows[0] ?? null;
}

export async function unsetDefaultAddress(
  client: pgClient,
  params: { userId: string },
): Promise<void> {
  const UNSET_DEFAULT = `
    UPDATE auth.addresses
    SET is_default = false, updated_at = now()
    WHERE user_id = $1 AND is_default = true
  `;
  await client.query(UNSET_DEFAULT, [params.userId]);
}

export async function createAddress(
  client: pgClient,
  params: {
    id: string;
    userId: string;
    type?: string;
    label?: string;
    line1: string;
    line2?: string;
    city: string;
    state?: string;
    postalCode: string;
    country?: string;
    isDefault?: boolean;
  },
): Promise<AddressRow> {
  const INSERT_ADDRESS = `
    INSERT INTO auth.addresses(
      id,
      user_id,
      type,
      label,
      line1,
      line2,
      city,
      state,
      postal_code,
      country,
      is_default
    )
    VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    RETURNING id, user_id, type, label, line1, line2, city, state, postal_code, country, is_default, created_at, updated_at
  `;
  const res = await client.query(INSERT_ADDRESS, [
    params.id,
    params.userId,
    params.type ?? 'shipping',
    params.label ?? null,
    params.line1,
    params.line2 ?? null,
    params.city,
    params.state ?? null,
    params.postalCode,
    params.country ?? 'US',
    params.isDefault ?? false,
  ]);
  return res.rows[0];
}

export async function updateAddress(
  client: pgClient,
  params: {
    id: string;
    userId: string;
    type?: string;
    label?: string;
    line1?: string;
    line2?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
    isDefault?: boolean;
  },
): Promise<AddressRow | null> {
  const UPDATE_ADDRESS = `
    UPDATE auth.addresses
    SET type = COALESCE($3, type),
        label = COALESCE($4, label),
        line1 = COALESCE($5, line1),
        line2 = COALESCE($6, line2),
        city = COALESCE($7, city),
        state = COALESCE($8, state),
        postal_code = COALESCE($9, postal_code),
        country = COALESCE($10, country),
        is_default = COALESCE($11, is_default),
        updated_at = now()
    WHERE id = $1 AND user_id = $2
    RETURNING id, user_id, type, label, line1, line2, city, state, postal_code, country, is_default, created_at, updated_at
  `;
  const res = await client.query(UPDATE_ADDRESS, [
    params.id,
    params.userId,
    params.type ?? null,
    params.label ?? null,
    params.line1 ?? null,
    params.line2 ?? null,
    params.city ?? null,
    params.state ?? null,
    params.postalCode ?? null,
    params.country ?? null,
    params.isDefault !== undefined ? params.isDefault : null,
  ]);
  return res.rows[0] ?? null;
}

export async function deleteAddress(
  client: pgClient,
  params: { id: string; userId: string },
): Promise<boolean> {
  const DELETE_ADDRESS = `
    DELETE FROM auth.addresses
    WHERE id = $1 AND user_id = $2
  `;
  const res = await client.query(DELETE_ADDRESS, [params.id, params.userId]);
  return (res.rowCount ?? 0) > 0;
}
