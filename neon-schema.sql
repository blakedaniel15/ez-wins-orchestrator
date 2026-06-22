-- EZ Wins Orchestrator — Phase 0 schema.
-- Paste into the Neon SQL editor on first setup.
-- (Comments are on their own lines so a newline-collapse on paste can't
--  comment out real SQL.)

-- project: the registry / keystone.
--   id        typed sequential, e.g. ONB-2026-0001
--   type      onboarding | support | warranty_uplift | investigation
--   substate  fine-grained state ClickUp can't hold
--   dms       underlying DMS: CDK, Reynolds, Tekion, DealerTrack, Automate, PBS...
--   conduit   direct | fortellis | dealervault | tekion | reynolds_rci
--   warranty_project_id  AI-Warranty-Analyst session id (WUP only)
create table if not exists project (
  id text primary key,
  type text not null,
  status text not null default 'new',
  substate jsonb not null default '{}'::jsonb,
  dms text,
  conduit text,
  dealer_name text,
  group_name text,
  moc_reps jsonb not null default '[]'::jsonb,
  outlook_conversation_id text,
  clickup_task_id text,
  portal_dealer_id text,
  warranty_project_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_project_conversation on project(outlook_conversation_id);
create index if not exists idx_project_type on project(type);
create index if not exists idx_project_dealer on project(lower(dealer_name));

-- project_counter: atomic per-(type, year) counter for ID minting.
--   type_year  e.g. ONB-2026
create table if not exists project_counter (
  type_year text primary key,
  n integer not null default 0
);
