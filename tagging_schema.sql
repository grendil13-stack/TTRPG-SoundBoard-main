-- Optional Supabase schema for personal tagging + suggestions.
-- Apply in the SQL editor or migrations. Adjust if `user_tags` already exists.

-- Suggested tags (public read). Categories must match app normalization: Moment, Quality, Campaign.
CREATE TABLE IF NOT EXISTS suggested_tags (
  tag text PRIMARY KEY,
  category text NOT NULL
);

ALTER TABLE suggested_tags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read suggested_tags" ON suggested_tags;
CREATE POLICY "Allow public read suggested_tags" ON suggested_tags
  FOR SELECT
  USING (true);

-- Per-user tag rows (app expects: user_id, audio_id, tag; optional created_at for recency).
-- If `user_tags` is created elsewhere, skip this block.
CREATE TABLE IF NOT EXISTS user_tags (
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  audio_id text NOT NULL,
  tag text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, audio_id, tag)
);

CREATE INDEX IF NOT EXISTS user_tags_user_created_idx ON user_tags (user_id, created_at DESC);

ALTER TABLE user_tags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own tags" ON user_tags;
CREATE POLICY "Users read own tags" ON user_tags
  FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users insert own tags" ON user_tags;
CREATE POLICY "Users insert own tags" ON user_tags
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users delete own tags" ON user_tags;
CREATE POLICY "Users delete own tags" ON user_tags
  FOR DELETE
  USING (auth.uid() = user_id);

-- Summary view for filtering (app also derives this client-side from full user_tags).
DROP VIEW IF EXISTS my_tag_summary;
CREATE VIEW my_tag_summary AS
SELECT
  user_id,
  tag,
  COUNT(*)::integer AS count,
  array_agg(audio_id ORDER BY audio_id) AS audio_ids
FROM user_tags
GROUP BY user_id, tag;
