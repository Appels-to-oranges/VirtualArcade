const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('railway.app')
    ? { rejectUnauthorized: false }
    : false,
});

pool.on('error', (err) => {
  console.error('Unexpected database pool error:', err);
});

async function ensureTables() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        username VARCHAR(20) UNIQUE NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        chips INTEGER NOT NULL DEFAULT 100,
        google_id VARCHAR(255) UNIQUE,
        discord_id VARCHAR(255) UNIQUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id VARCHAR(255) UNIQUE`).catch(() => {});
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS discord_id VARCHAR(255) UNIQUE`).catch(() => {});
    await pool.query(`
      CREATE TABLE IF NOT EXISTS favorite_stations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        station_name VARCHAR(255) NOT NULL,
        station_url TEXT NOT NULL,
        favicon TEXT,
        country VARCHAR(100),
        tags TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(user_id, station_url)
      );
    `);
    console.log('Database tables ready');
  } catch (err) {
    console.error('Failed to create tables:', err.message);
  }
}

if (process.env.DATABASE_URL) {
  ensureTables();
}

module.exports = pool;
