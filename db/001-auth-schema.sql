BEGIN;

CREATE SCHEMA IF NOT EXISTS auth;

-- 1. users
CREATE TABLE IF NOT EXISTS auth.users (
  id uuid DEFAULT gen_random_uuid(),
  email varchar(255) NOT NULL,
  password_hash varchar(255) NOT NULL,
  first_name varchar(100) NOT NULL,
  last_name varchar(100) NOT NULL,
  phone varchar(20),
  avatar_url varchar(2048),
  status varchar(20) DEFAULT 'active' NOT NULL,
  last_login_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT users_pkey PRIMARY KEY (id),
  CONSTRAINT users_email_key UNIQUE (email),
  CONSTRAINT users_status_check CHECK (status IN ('active', 'disabled', 'pending')),
  CONSTRAINT users_email_lowercase_check CHECK (email = lower(email))
);

-- 2. addresses
CREATE TABLE IF NOT EXISTS auth.addresses (
  id uuid DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  type varchar(10) DEFAULT 'shipping' NOT NULL,
  label varchar(50),
  line1 varchar(255) NOT NULL,
  line2 varchar(255),
  city varchar(100) NOT NULL,
  state varchar(100),
  postal_code varchar(20) NOT NULL,
  country varchar(2) DEFAULT 'US' NOT NULL,
  is_default boolean DEFAULT false NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT addresses_pkey PRIMARY KEY (id),
  CONSTRAINT addresses_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT addresses_type_check CHECK (type IN ('shipping', 'billing'))
);

-- 3. roles
CREATE TABLE IF NOT EXISTS auth.roles (
  id uuid DEFAULT gen_random_uuid(),
  name varchar(50) NOT NULL,
  slug varchar(50) NOT NULL,
  description varchar(255),
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT roles_pkey PRIMARY KEY (id),
  CONSTRAINT roles_slug_key UNIQUE (slug)
);

-- 4. permissions
CREATE TABLE IF NOT EXISTS auth.permissions (
  id uuid DEFAULT gen_random_uuid(),
  name varchar(100) NOT NULL,
  slug varchar(100) NOT NULL,
  description varchar(255),
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT permissions_pkey PRIMARY KEY (id),
  CONSTRAINT permissions_slug_key UNIQUE (slug)
);

-- 5. refresh_tokens
CREATE TABLE IF NOT EXISTS auth.refresh_tokens (
  id uuid DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  family_id uuid NOT NULL,
  token_hash varchar(255) NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT refresh_tokens_pkey PRIMARY KEY (id),
  CONSTRAINT refresh_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT refresh_tokens_token_hash_key UNIQUE (token_hash)
);

-- 6. role_permissions
CREATE TABLE IF NOT EXISTS auth.role_permissions (
  role_id uuid NOT NULL,
  permission_id uuid NOT NULL,
  CONSTRAINT role_permissions_pkey PRIMARY KEY (role_id, permission_id),
  CONSTRAINT role_permissions_role_id_fkey FOREIGN KEY (role_id) REFERENCES auth.roles(id) ON DELETE CASCADE,
  CONSTRAINT role_permissions_permission_id_fkey FOREIGN KEY (permission_id) REFERENCES auth.permissions(id) ON DELETE CASCADE
);

-- 7. user_roles
CREATE TABLE IF NOT EXISTS auth.user_roles (
  user_id uuid NOT NULL,
  role_id uuid NOT NULL,
  CONSTRAINT user_roles_pkey PRIMARY KEY (user_id, role_id),
  CONSTRAINT user_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT user_roles_role_id_fkey FOREIGN KEY (role_id) REFERENCES auth.roles(id) ON DELETE CASCADE
);

-- Explicit indexes
CREATE INDEX IF NOT EXISTS idx_users_status ON auth.users (status);
CREATE INDEX IF NOT EXISTS idx_addresses_user_id ON auth.addresses (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS one_default_per_user ON auth.addresses (user_id) WHERE is_default;
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON auth.refresh_tokens (user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_family_id ON auth.refresh_tokens (family_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires_at ON auth.refresh_tokens (expires_at);
CREATE INDEX IF NOT EXISTS idx_role_permissions_permission_id ON auth.role_permissions (permission_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_role_id ON auth.user_roles (role_id);

-- Trigger function and triggers for updated_at
CREATE OR REPLACE FUNCTION auth.set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_users_updated_at ON auth.users;
CREATE TRIGGER set_users_updated_at
  BEFORE UPDATE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION auth.set_updated_at();

DROP TRIGGER IF EXISTS set_addresses_updated_at ON auth.addresses;
CREATE TRIGGER set_addresses_updated_at
  BEFORE UPDATE ON auth.addresses
  FOR EACH ROW EXECUTE FUNCTION auth.set_updated_at();

DROP TRIGGER IF EXISTS set_roles_updated_at ON auth.roles;
CREATE TRIGGER set_roles_updated_at
  BEFORE UPDATE ON auth.roles
  FOR EACH ROW EXECUTE FUNCTION auth.set_updated_at();

DROP TRIGGER IF EXISTS set_permissions_updated_at ON auth.permissions;
CREATE TRIGGER set_permissions_updated_at
  BEFORE UPDATE ON auth.permissions
  FOR EACH ROW EXECUTE FUNCTION auth.set_updated_at();

COMMIT;
