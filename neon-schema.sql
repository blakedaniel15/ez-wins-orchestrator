-- EZ Wins Orchestrator — schema (Phase 0.5: group / dealership / project).
-- Paste into the Neon SQL editor. Idempotent. Comments on their own lines
-- so a newline-collapse on paste can't comment out real SQL.

-- dealer_group: persistent dealer group. ("group" is a reserved SQL word.)
create table if not exists dealer_group (
  id text primary key,
  name text not null,
  billing_email text,
  portal_group_id text,
  outlook_conversation_id text,
  substate jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- dealership: persistent, first-class. The guiding light. One per real store.
create table if not exists dealership (
  id text primary key,
  group_id text references dealer_group(id),
  name text not null,
  dms text,
  conduit text,
  oems jsonb not null default '[]'::jsonb,
  portal_dealer_id text,
  status text not null default 'prospect',
  substate jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- project: time-bound engagement, always tied to a dealership. Ends.
create table if not exists project (
  id text primary key,
  type text not null,
  dealership_id text references dealership(id),
  status text not null default 'new',
  substate jsonb not null default '{}'::jsonb,
  outlook_conversation_id text,
  clickup_task_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ended_at timestamptz
);

-- atomic counter for ID minting (project type-years AND GRP/DLR)
create table if not exists project_counter (
  type_year text primary key,
  n integer not null default 0
);

create index if not exists idx_dealership_group  on dealership(group_id);
create index if not exists idx_dealership_portal  on dealership(portal_dealer_id);
create index if not exists idx_dealership_name    on dealership(lower(name));
create index if not exists idx_project_dealership on project(dealership_id);
create index if not exists idx_project_type       on project(type);
create index if not exists idx_project_conv       on project(outlook_conversation_id);
create index if not exists idx_group_conv         on dealer_group(outlook_conversation_id);

-- group-deal lifecycle (added 2026-06-29)
alter table dealer_group add column if not exists status text not null default 'open';
alter table dealer_group add column if not exists contacts jsonb not null default '[]'::jsonb;
alter table dealer_group add column if not exists locations_url text;

-- decision_log: every confirm/edit/reject on an automation proposal (dealership-anchored, type-faceted)
create table if not exists decision_log (
  id bigserial primary key,
  kind text not null,
  type text,
  dealership_id text,
  group_id text,
  proposal jsonb not null default '{}'::jsonb,
  decision text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_decision_dealership on decision_log(dealership_id);
create index if not exists idx_decision_kind on decision_log(kind);

-- ===== Onboarding-skill port (2026-06-30) =====
-- Onboarding-skill port: dealership onboarding columns + supporting tables.
-- Run ONCE in the orchestrator's Neon DB. Idempotent (safe to re-run).

alter table dealership add column if not exists address text;
alter table dealership add column if not exists city text;
alter table dealership add column if not exists state text;
alter table dealership add column if not exists zip text;
alter table dealership add column if not exists region text;
alter table dealership add column if not exists brand text;
alter table dealership add column if not exists door_rate text not null default '$225';
alter table dealership add column if not exists platform_fields jsonb not null default '{}'::jsonb;
alter table dealership add column if not exists lifecycle_stage text not null default 'pending';
alter table dealership add column if not exists parts_users_onboarded boolean not null default false;

create table if not exists contact (
  id bigserial primary key,
  dealership_id text,
  group_id text,
  name text,
  email text,
  kind text not null default 'moc',          -- moc | dealer
  source text,
  created_at timestamptz not null default now()
);
create index if not exists idx_contact_dealership on contact(dealership_id);
create index if not exists idx_contact_group on contact(group_id);

create table if not exists roster_member (
  id bigserial primary key,
  project_id text not null,
  name text,
  email text,
  role text,                                  -- manager|owner|gm|fod|advisor|technician
  dms_id text,
  source text,                                -- form_typed|form_upload|email_text|email_attachment|email_image
  confidence real not null default 1,
  missing jsonb not null default '[]'::jsonb,
  action text not null default 'none',        -- none|reach_back|internal_id_pull|clear_manually
  created_at timestamptz not null default now()
);
create index if not exists idx_roster_project on roster_member(project_id);

create table if not exists action_queue (
  id bigserial primary key,
  project_id text,
  conversation_id text,
  kind text not null,                         -- draft_reply|create_task|reach_back|send_welcome|login_prompt|internal_pull
  proposed_payload jsonb not null default '{}'::jsonb,
  state text not null default 'pending',      -- pending|approved|edited|rejected|sent
  decision jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_action_state on action_queue(state);
create index if not exists idx_action_project on action_queue(project_id);

create table if not exists cadence (
  id bigserial primary key,
  project_id text not null,
  type text not null,
  track text not null,                        -- customer|moc_rep|missing_email|integration_chase
  anchor_sent_at timestamptz,
  next_due timestamptz,
  step int not null default 0,
  stopped_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_cadence_due on cadence(next_due) where stopped_reason is null;
