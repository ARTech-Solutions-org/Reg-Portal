CREATE TABLE IF NOT EXISTS public.organizers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  open_id text,
  email text,
  username text,
  display_name text NOT NULL,
  password_hash text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.organizers ADD COLUMN IF NOT EXISTS open_id text;
ALTER TABLE public.organizers ADD COLUMN IF NOT EXISTS username text;
ALTER TABLE public.organizers ADD COLUMN IF NOT EXISTS password_hash text;
ALTER TABLE public.organizers ALTER COLUMN open_id DROP NOT NULL;
ALTER TABLE public.organizers ALTER COLUMN email DROP NOT NULL;
ALTER TABLE public.organizers ALTER COLUMN password_hash DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS organizers_open_id_uidx ON public.organizers(open_id);
CREATE UNIQUE INDEX IF NOT EXISTS organizers_username_uidx ON public.organizers(username) WHERE username IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  schema_name text NOT NULL UNIQUE,
  created_by uuid NOT NULL REFERENCES public.organizers(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.project_memberships (
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  organizer_id uuid NOT NULL REFERENCES public.organizers(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'manager', 'viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, organizer_id)
);

CREATE TABLE IF NOT EXISTS public.events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  starts_at timestamptz,
  venue text,
  schema_name text NOT NULL,
  attendee_table_name text NOT NULL,
  checkin_table_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (schema_name, attendee_table_name),
  UNIQUE (schema_name, checkin_table_name)
);

CREATE INDEX IF NOT EXISTS events_project_created_idx ON public.events(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.scanner_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  label text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  token_ciphertext text,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_by uuid NOT NULL REFERENCES public.organizers(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.scanner_links ADD COLUMN IF NOT EXISTS token_ciphertext text;

CREATE INDEX IF NOT EXISTS scanner_links_event_idx ON public.scanner_links(event_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.badge_layouts (
  event_id uuid PRIMARY KEY REFERENCES public.events(id) ON DELETE CASCADE,
  layout jsonb NOT NULL,
  updated_by uuid NOT NULL REFERENCES public.organizers(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.badge_templates (
  event_id uuid PRIMARY KEY REFERENCES public.events(id) ON DELETE CASCADE,
  storage_key text NOT NULL UNIQUE,
  file_name text NOT NULL,
  page_count integer NOT NULL CHECK (page_count BETWEEN 1 AND 200),
  page_width double precision NOT NULL CHECK (page_width > 0 AND page_width <= 3000),
  page_height double precision NOT NULL CHECK (page_height > 0 AND page_height <= 3000),
  updated_by uuid NOT NULL REFERENCES public.organizers(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.event_attendee_fields (
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  field_key text NOT NULL CHECK (field_key ~ '^[A-Za-z][A-Za-z0-9 ._-]{0,49}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, field_key)
);

CREATE TABLE IF NOT EXISTS public.scanner_branding (
  event_id uuid PRIMARY KEY REFERENCES public.events(id) ON DELETE CASCADE,
  branding jsonb NOT NULL,
  updated_by uuid NOT NULL REFERENCES public.organizers(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.project_branding (
  project_id uuid PRIMARY KEY REFERENCES public.projects(id) ON DELETE CASCADE,
  branding jsonb NOT NULL,
  updated_by uuid NOT NULL REFERENCES public.organizers(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
