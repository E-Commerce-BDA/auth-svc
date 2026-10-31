# Database Schema Management (auth schema)

This directory contains the hand-written SQL schema definitions and initial seeds for `auth-svc`.

## Ownership
- `auth-svc` strictly owns the `auth` PostgreSQL schema in the shared database.
- Other services must never write to or directly query the `auth` schema.
- Cross-schema foreign keys are forbidden; internal relationships within `auth` use foreign keys with cascading deletions where appropriate.

## Apply Order
Run the numbered scripts sequentially:
1. `001-auth-schema.sql` — Schema definition, 7 core tables, named constraints, indexes, and `set_updated_at` triggers.
2. `002-seed-roles.sql` — Default roles (`admin`, `customer`).
3. `003-auth-outbox.sql` — Transactional outbox (`user.registered`), its partial index, and the two envelope/row consistency checks.

### PowerShell Apply Command
Execute using the running `ecom-pg` container with `ON_ERROR_STOP=1`:
```powershell
Get-Content db/001-auth-schema.sql | docker exec -i ecom-pg psql -U ecom -d ecom -v ON_ERROR_STOP=1
Get-Content db/002-seed-roles.sql | docker exec -i ecom-pg psql -U ecom -d ecom -v ON_ERROR_STOP=1
Get-Content db/003-auth-outbox.sql | docker exec -i ecom-pg psql -U ecom -d ecom -v ON_ERROR_STOP=1
```

Or via direct PostgreSQL client:
```powershell
psql "$env:DATABASE_URL" -v ON_ERROR_STOP=1 -f db/001-auth-schema.sql
psql "$env:DATABASE_URL" -v ON_ERROR_STOP=1 -f db/002-seed-roles.sql
psql "$env:DATABASE_URL" -v ON_ERROR_STOP=1 -f db/003-auth-outbox.sql
```

## Verification Queries
Check that all 8 tables exist:
```powershell
docker exec -i ecom-pg psql -U ecom -d ecom -c "SELECT table_name FROM information_schema.tables WHERE table_schema = 'auth' ORDER BY table_name;"
```
Expected output:
```text
   table_name   
----------------
 addresses
 outbox
 permissions
 refresh_tokens
 role_permissions
 roles
 user_roles
 users
(8 rows)
```

Verify seeded roles:
```powershell
docker exec -i ecom-pg psql -U ecom -d ecom -c "SELECT slug, name, description FROM auth.roles ORDER BY slug;"
```
Expected output:
```text
   slug   |   name   |       description        
----------+----------+--------------------------
 admin    | Admin    | Full administrative access
 customer | Customer | Shopper account
(2 rows)
```

## Idempotency & Re-run Guarantee
- Scripts are safe to re-run while definitions match (`CREATE ... IF NOT EXISTS`, `ON CONFLICT (slug) DO NOTHING`, `DROP TRIGGER IF EXISTS`).
- **Create-only policy (no migration runner in v1):** `CREATE TABLE IF NOT EXISTS` will not alter existing columns or add new constraints. Future schema evolutions require an explicit manual `ALTER` or a destructive reset.

## Reset (Destructive)
To tear down the schema completely in development:
```powershell
docker exec -i ecom-pg psql -U ecom -d ecom -c "DROP SCHEMA auth CASCADE;"
```
Then re-apply `001-auth-schema.sql` followed by `002-seed-roles.sql` and `003-auth-outbox.sql`.
