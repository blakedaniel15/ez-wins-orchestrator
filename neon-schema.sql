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
