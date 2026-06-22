-- EZ Wins Orchestrator — Phase 0 schema.
-- Paste into the Neon SQL editor on first setup.

create table if not exists project (
  id           text primary key,          -- ONB-2026-0001
  type         text not null,             -- onboarding | support | warranty_uplift | investigation
  status       text not null default 'new',
  substate     jsonb not null default '{}'::jsonb,
  dms          text,                      -- underlying: CDK, Reynolds, Tekion, DealerTrack, Automate, PBS...
  conduit      text,                      -- direct | fortellis | dealervault | tekion | reynolds_rci
  dealer_name  text,
  group_name   text,
  moc_reps     jsonb not null default '[]'::jsonb,
  outlook_conversation_id text,
  clickup_task_id         text,
  portal_dealer_id        text,
  warranty_project_id     text,           -- AI-Warranty-Analyst session id (WUP only)
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_project_conversation on project(outlook_conversation_id);
create index if not exists idx_project_type         on project(type);
create index if not exists idx_project_dealer        on project(lower(dealer_name));

-- atomic per-(type, year) counter for ID minting
create table if not exists project_counter (
  type_year text primary key,             -- e.g. ONB-2026
  n         integer not null default 0
);
