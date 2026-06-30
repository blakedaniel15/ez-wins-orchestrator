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
