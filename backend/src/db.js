import pg from "pg";

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

export async function query(text, params) {
  return pool.query(text, params);
}

export async function ensureSchema() {
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await query(`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS consent_photo_use BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS consent_authentic BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS consent_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS username TEXT UNIQUE,
      ADD COLUMN IF NOT EXISTS avatar_base TEXT,
      ADD COLUMN IF NOT EXISTS avatar_props TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
      ADD COLUMN IF NOT EXISTS theme_preference TEXT NOT NULL DEFAULT 'light',
      ADD COLUMN IF NOT EXISTS certificate_earned_at TIMESTAMPTZ;
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS user_daily_actions (
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      action_date DATE NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, action_date)
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS bingo_items (
      id SERIAL PRIMARY KEY,
      label TEXT NOT NULL
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS user_item_status (
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      item_id INTEGER NOT NULL REFERENCES bingo_items(id) ON DELETE CASCADE,
      checked BOOLEAN NOT NULL DEFAULT FALSE,
      image_url TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, item_id)
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS line_completions (
      id BIGSERIAL PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      line_key TEXT NOT NULL,
      line_label TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, line_key)
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS user_surveys (
      user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      is_under_30 BOOLEAN,
      age_range TEXT,
      race TEXT,
      disability TEXT,
      rural TEXT,
      location TEXT,
      discovery_source TEXT,
      friend_referral_email TEXT,
      cycat_referral_email TEXT,
      other_discovery TEXT,
      completed_at TIMESTAMPTZ,
      skipped_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await query(`
    ALTER TABLE user_surveys
      ADD COLUMN IF NOT EXISTS is_under_30 BOOLEAN;
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS password_resets (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

export async function ensureItems(labels) {
  const { rows } = await query("SELECT COUNT(*)::int AS count FROM bingo_items");
  if (rows[0].count > 0) return;

  const values = labels.map((label, i) => `($${i + 1})`).join(",");
  await query(`INSERT INTO bingo_items (label) VALUES ${values}`, labels);
}
