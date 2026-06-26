-- Phase 0.5 migration. Run ONCE in the Neon SQL editor. Idempotent.
-- Adds dealer_group + dealership, links project.dealership_id, and migrates
-- the single Phase-0 test row (ONB-2026-0001 / Steve Hahn) into a dealership.

create table if not exists dealer_group (
  id text primary key, name text not null, billing_email text,
  portal_group_id text, outlook_conversation_id text,
  substate jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists dealership (
  id text primary key, group_id text references dealer_group(id), name text not null,
  dms text, conduit text, oems jsonb not null default '[]'::jsonb, portal_dealer_id text,
  status text not null default 'prospect', substate jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

alter table project add column if not exists dealership_id text references dealership(id);
alter table project add column if not exists ended_at timestamptz;

create index if not exists idx_dealership_group  on dealership(group_id);
create index if not exists idx_dealership_portal  on dealership(portal_dealer_id);
create index if not exists idx_dealership_name    on dealership(lower(name));
create index if not exists idx_project_dealership on project(dealership_id);

-- Migrate the single test row into a dealership.
insert into dealership (id, name, dms, conduit, oems, portal_dealer_id, status)
select 'DLR-000001',
       coalesce(p.dealer_name, 'Steve Hahn Volkswagen, Mercedes, Kia'),
       p.dms, p.conduit, '["Volkswagen","Mercedes","Kia"]'::jsonb,
       coalesce(p.portal_dealer_id, 'd_1780607333618_egnvk'), 'onboarding'
from project p where p.id = 'ONB-2026-0001'
on conflict (id) do nothing;

update project set dealership_id = 'DLR-000001' where id = 'ONB-2026-0001' and dealership_id is null;

-- Seed the DLR counter so the next mint is DLR-000002.
insert into project_counter (type_year, n) values ('DLR', 1)
on conflict (type_year) do update set n = greatest(project_counter.n, 1);
