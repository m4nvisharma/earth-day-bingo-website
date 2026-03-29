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
}

export async function ensureItems(labels) {
  const { rows } = await query("SELECT COUNT(*)::int AS count FROM bingo_items");
  if (rows[0].count > 0) return;

  const values = labels.map((label, i) => `($${i + 1})`).join(",");
  await query(`INSERT INTO bingo_items (label) VALUES ${values}`, labels);
}
