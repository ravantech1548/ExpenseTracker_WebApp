-- Slice 1 schema: login and configuration

CREATE TABLE users (
  id              SERIAL PRIMARY KEY,
  username        TEXT UNIQUE,                 -- local accounts
  email           TEXT UNIQUE,                 -- Gmail accounts
  name            TEXT NOT NULL,
  password_hash   TEXT,                        -- bcrypt; NULL for Gmail accounts
  role            TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'rejected')),
  failed_attempts INT NOT NULL DEFAULT 0,
  locked_until    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  token      TEXT PRIMARY KEY,
  user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE family_members (
  id   SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE categories (
  id     SERIAL PRIMARY KEY,
  name   TEXT NOT NULL UNIQUE,
  colour TEXT
);

CREATE TABLE providers (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  category_id INT REFERENCES categories(id) ON DELETE SET NULL
);

CREATE TABLE payment_modes (
  id   SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE currencies (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

-- Category colours from plan section 8.1. Subscriptions and Miscellaneous are Unknown (NULL).
INSERT INTO categories (name, colour) VALUES
  ('Telco', '#a28be5'),
  ('Utilities', '#f6b26b'),
  ('Credit cards', '#f7d4d4'),
  ('Insurance', '#9fc5e8'),
  ('Income tax', '#c4f061'),
  ('Subscriptions', NULL),
  ('Miscellaneous', NULL);

INSERT INTO currencies (code, name) VALUES ('SGD', 'Singapore dollar'), ('INR', 'Indian rupee');
