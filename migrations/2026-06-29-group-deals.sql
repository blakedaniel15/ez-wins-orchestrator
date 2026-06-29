-- Group-deal lifecycle + decision log. Run ONCE in the Neon SQL editor. Idempotent.

alter table dealer_group add column if not exists status text not null default 'open';
alter table dealer_group add column if not exists contacts jsonb not null default '[]'::jsonb;
alter table dealer_group add column if not exists locations_url text;

-- Imported groups (they carry a portal_group_id) are historical, not active deals → mark complete.
-- New deals created via the app default to 'open'. Safe to re-run.
update dealer_group set status = 'complete' where portal_group_id is not null;

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
