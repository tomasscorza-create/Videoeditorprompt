CREATE TABLE local_video.projects (
  id text PRIMARY KEY
    CHECK (id ~ '^[a-zA-Z0-9][a-zA-Z0-9_-]{1,63}$'),
  revision char(64) NOT NULL
    CHECK (revision ~ '^[a-f0-9]{64}$'),
  document jsonb NOT NULL
    CHECK (jsonb_typeof(document) = 'object')
    CHECK (document @> '{"version": 1}'::jsonb)
    CHECK (document ->> 'id' = id)
    CHECK (octet_length(document::text) <= 1048576),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX projects_updated_at_idx
  ON local_video.projects (updated_at DESC, id);

CREATE TABLE local_video.resources (
  id text PRIMARY KEY
    CHECK (id ~ '^[a-zA-Z0-9][a-zA-Z0-9_-]{1,63}$'),
  content_hash char(64) NOT NULL UNIQUE
    CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  registered_at timestamptz NOT NULL,
  document jsonb NOT NULL
    CHECK (jsonb_typeof(document) = 'object')
    CHECK (document ->> 'id' = id)
    CHECK (document ->> 'contentHash' = content_hash)
    CHECK (jsonb_typeof(document -> 'entry') = 'object')
    CHECK (document -> 'entry' ->> 'id' = id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX resources_registered_at_idx
  ON local_video.resources (registered_at, id);

CREATE TABLE local_video.render_jobs (
  job_id text PRIMARY KEY
    CHECK (job_id ~ '^[a-zA-Z0-9][a-zA-Z0-9_-]{1,63}$'),
  project_id text NOT NULL,
  state text NOT NULL CHECK (char_length(state) BETWEEN 1 AND 64),
  stage text NOT NULL CHECK (char_length(stage) BETWEEN 1 AND 64),
  document jsonb NOT NULL
    CHECK (jsonb_typeof(document) = 'object')
    CHECK (document @> '{"version": 1}'::jsonb)
    CHECK (document ->> 'jobId' = job_id)
    CHECK (document ->> 'projectId' = project_id)
    CHECK (document ->> 'state' = state)
    CHECK (document ->> 'stage' = stage)
    CHECK (octet_length(document::text) <= 1048576),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE INDEX render_jobs_created_at_idx
  ON local_video.render_jobs (created_at DESC, job_id);

CREATE INDEX render_jobs_state_created_at_idx
  ON local_video.render_jobs (state, created_at DESC, job_id);
