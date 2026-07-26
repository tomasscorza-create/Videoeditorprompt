ALTER TABLE local_video.projects
  ADD CONSTRAINT projects_title_contract
    CHECK (
      jsonb_typeof(document -> 'title') = 'string'
      AND char_length(document ->> 'title') BETWEEN 1 AND 120
    ),
  ADD CONSTRAINT projects_scenes_contract
    CHECK (
      jsonb_typeof(document -> 'scenes') = 'array'
      AND jsonb_array_length(document -> 'scenes') BETWEEN 1 AND 8
    );

ALTER TABLE local_video.resources
  ADD CONSTRAINT resources_registered_at_contract
    CHECK ((document ->> 'registeredAt')::timestamptz = registered_at);

ALTER TABLE local_video.render_jobs
  ADD CONSTRAINT render_jobs_created_at_contract
    CHECK ((document ->> 'createdAt')::timestamptz = created_at),
  ADD CONSTRAINT render_jobs_updated_at_contract
    CHECK ((document ->> 'updatedAt')::timestamptz = updated_at);
