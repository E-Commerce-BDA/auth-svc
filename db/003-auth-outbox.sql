BEGIN;

-- 003-auth-outbox.sql — transactional outbox for user.registered.
-- Apply after 002-seed-roles.sql.
--
-- The row is written by auth-svc inside the same transaction that inserts the
-- user, so a committed registration always has exactly one event and a rolled
-- back registration has none. The relay (from @ecom/messaging) publishes the
-- stored envelope and flips status to 'published'.

CREATE TABLE IF NOT EXISTS auth.outbox (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id       uuid NOT NULL UNIQUE,
  aggregate_type varchar(50)  NOT NULL,
  aggregate_id   uuid         NOT NULL,
  event_type     varchar(100) NOT NULL,
  -- The finished envelope, byte-for-byte what the relay publishes. Storing the
  -- payload instead would move contract validation to publish time.
  envelope       jsonb        NOT NULL,
  status         varchar(20)  NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','published','failed')),
  attempts       integer      NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error     text         NULL,
  locked_until   timestamptz  NULL,
  created_at     timestamptz  NOT NULL DEFAULT now(),
  published_at   timestamptz  NULL,
  CONSTRAINT outbox_aggregate_type_check CHECK (aggregate_type IN ('user')),
  CONSTRAINT outbox_event_type_is_user_registered CHECK (event_type = 'user.registered'),
  -- The row may not disagree with its own envelope. No cast on envelope->>'id',
  -- so a malformed envelope fails the check instead of raising a cast error.
  CONSTRAINT outbox_envelope_type_matches CHECK (envelope->>'type' = event_type),
  CONSTRAINT outbox_envelope_id_matches   CHECK (envelope->>'id' = event_id::text)
);

-- The relay only ever claims pending rows in creation order.
CREATE INDEX IF NOT EXISTS idx_outbox_pending ON auth.outbox (created_at) WHERE status = 'pending';

COMMIT;
