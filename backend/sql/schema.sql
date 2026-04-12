CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  consent_photo_use BOOLEAN NOT NULL DEFAULT FALSE,
  consent_authentic BOOLEAN NOT NULL DEFAULT FALSE,
  consent_at TIMESTAMPTZ,
  username TEXT UNIQUE,
  avatar_base TEXT,
  avatar_props TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  theme_preference TEXT NOT NULL DEFAULT 'light',
  certificate_earned_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_daily_actions (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action_date DATE NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, action_date)
);

CREATE TABLE IF NOT EXISTS bingo_items (
  id SERIAL PRIMARY KEY,
  label TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_item_status (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES bingo_items(id) ON DELETE CASCADE,
  checked BOOLEAN NOT NULL DEFAULT FALSE,
  image_url TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, item_id)
);

CREATE TABLE IF NOT EXISTS line_completions (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  line_key TEXT NOT NULL,
  line_label TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, line_key)
);

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
