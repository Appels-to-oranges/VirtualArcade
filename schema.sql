-- Virtual Arcade database schema
-- Run against your Railway PostgreSQL database to set up tables

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username VARCHAR(20) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  chips INTEGER NOT NULL DEFAULT 100,
  purchased_outfits TEXT[] NOT NULL DEFAULT '{}',
  equipped_outfit VARCHAR(50),
  purchased_characters TEXT[] NOT NULL DEFAULT '{}',
  equipped_character VARCHAR(50),
  google_id VARCHAR(255) UNIQUE,
  discord_id VARCHAR(255) UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Safe migration for existing databases
ALTER TABLE users ADD COLUMN IF NOT EXISTS purchased_outfits TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE users ADD COLUMN IF NOT EXISTS equipped_outfit VARCHAR(50);
ALTER TABLE users ADD COLUMN IF NOT EXISTS purchased_characters TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE users ADD COLUMN IF NOT EXISTS equipped_character VARCHAR(50);

-- Session store for connect-pg-simple
CREATE TABLE IF NOT EXISTS "session" (
  "sid" VARCHAR NOT NULL COLLATE "default",
  "sess" JSON NOT NULL,
  "expire" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "session_pkey" PRIMARY KEY ("sid")
);

CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");
