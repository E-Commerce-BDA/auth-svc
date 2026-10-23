BEGIN;

INSERT INTO auth.roles (name, slug, description) VALUES
  ('Admin', 'admin', 'Full administrative access'),
  ('Customer', 'customer', 'Shopper account')
ON CONFLICT (slug) DO NOTHING;

COMMIT;
