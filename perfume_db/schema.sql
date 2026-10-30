-- master_perfumes: one row per fragrance (brand + name + concentration).
CREATE TABLE IF NOT EXISTS master_perfumes (
  id            INTEGER PRIMARY KEY,
  fingerprint   TEXT UNIQUE NOT NULL,      -- normalised brand|name|concentration, dedup key
  brand         TEXT NOT NULL,
  name          TEXT NOT NULL,
  concentration TEXT,                      -- EDP, EDT, Extrait, Cologne...
  country       TEXT,                      -- brand country (ISO-2)
  segment       TEXT,                      -- niche_fr, niche_emergent, niche_intl
  nose          TEXT,                      -- perfumer(s), comma separated
  year          INTEGER,
  notes_top     TEXT,                      -- JSON array
  notes_heart   TEXT,                      -- JSON array
  notes_base    TEXT,                      -- JSON array
  notes_all     TEXT,                      -- JSON array (flat list when no pyramid is given)
  family        TEXT,                      -- derived olfactory family
  longevity     REAL,                      -- tenue 0-5 (declared or NLP)
  sillage       REAL,                      -- 0-5 (declared or NLP)
  price_eur     REAL,                      -- reference retail price
  size_ml       REAL,
  price_per_ml  REAL,
  rating_avg    REAL,
  rating_count  INTEGER DEFAULT 0,
  url           TEXT,
  image_url     TEXT,
  description   TEXT,
  sources       TEXT,                      -- JSON array of source tags
  updated_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reviews (
  id           INTEGER PRIMARY KEY,
  review_hash  TEXT UNIQUE NOT NULL,       -- sha1(source|perfume|body), dedup key
  perfume_id   INTEGER REFERENCES master_perfumes(id) ON DELETE CASCADE,
  source       TEXT NOT NULL,
  rating       REAL,                       -- 1-5
  title        TEXT,
  body         TEXT NOT NULL,
  lang         TEXT,
  verified     INTEGER,
  review_date  TEXT,
  -- NLP outputs
  sentiment    REAL,                       -- -1..1
  asp_longevity REAL,                      -- -1..1, NULL = not mentioned
  asp_sillage  REAL,
  asp_price    REAL
);

CREATE INDEX IF NOT EXISTS ix_reviews_perfume ON reviews(perfume_id);
CREATE INDEX IF NOT EXISTS ix_perfumes_brand ON master_perfumes(brand);
