# Phase 0.5 — Group / Dealership / Project Entity Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the orchestrator's flat `project` table into the three-tier persistent model — `dealer_group → dealership → project` — with the dealership as the first-class entity, so every later phase creates and references these entities.

**Architecture:** Add `dealer_group` and `dealership` tables; move per-dealer fields off `project` onto `dealership`; add `dealership_id` to `project`. New `lib/` modules (`groups.ts`, `dealerships.ts`) and API routes mirror the Phase 0 patterns (lazy Neon client, `isAuthed` guard, JSON routes). The internal page gains group/dealership create + views and a chain reverse-lookup.

**Tech Stack:** Next.js 14 (App Router), TypeScript, `@neondatabase/serverless` (lazy client in `lib/db.ts`), Upstash Redis (sessions only). Deploy: GitHub `main` → Vercel auto-deploy.

## Global Constraints

- TypeScript, strict mode (`tsconfig.json` `strict: true`). Reused style objects in `.tsx` must be `as const` to satisfy `CSSProperties`.
- All API routes: `export const runtime = 'nodejs'` and guard with `isAuthed()` from `@/lib/security` (return `unauthorized()` if false). Public-facing none.
- Neon `coalesce($1, col)` updates must cast the param: `coalesce(${x ?? null}::text, col)` — untyped null params throw "could not determine data type".
- jsonb columns: pass `${JSON.stringify(v)}::jsonb`.
- ID formats: persistent `GRP-000007` / `DLR-000142` (zero-pad 6, no year); projects `ONB-2026-0001` (unchanged).
- **Verification model:** no local test runner. Each task verifies via (a) Vercel build green after push to `main`, and (b) a check on the internal page or a Neon SQL query. Commit per task; push triggers the build.
- Do not edit sibling repos. Commit only to `ez-wins-orchestrator`, branch `main`.

---

### Task 1: Schema — new tables, alter `project`, migrate the test row

**Files:**
- Modify: `neon-schema.sql`
- Create: `migrations/2026-06-24-entity-model.sql` (idempotent migration for the existing DB)

**Interfaces:**
- Produces: tables `dealer_group`, `dealership`; `project.dealership_id` column; `project` no longer relies on `dealer_name/dms/conduit/portal_dealer_id`.

- [ ] **Step 1: Replace the schema body in `neon-schema.sql`** with the three-tier model (paste-safe, comments on their own lines):

```sql
-- EZ Wins Orchestrator — schema (Phase 0.5: group/dealership/project).
-- Paste into the Neon SQL editor. Idempotent.

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
```

- [ ] **Step 2: Create `migrations/2026-06-24-entity-model.sql`** — additive migration for the live DB that already has the old `project` table (with dealer columns) and one test row:

```sql
-- Phase 0.5 migration. Run once in the Neon SQL editor. Idempotent.

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

-- Migrate the single test row (ONB-2026-0001 / Steve Hahn) into a dealership.
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
```

- [ ] **Step 3: Apply the migration** — paste `migrations/2026-06-24-entity-model.sql` into the Neon SQL editor and run it.

- [ ] **Step 4: Verify in Neon** — run:

```sql
select p.id, p.dealership_id, d.name, d.oems, d.portal_dealer_id
from project p join dealership d on d.id = p.dealership_id where p.id = 'ONB-2026-0001';
```
Expected: one row, `dealership_id = DLR-000001`, name = Steve Hahn…, oems = `["Volkswagen","Mercedes","Kia"]`, portal_dealer_id = `d_1780607333618_egnvk`.

- [ ] **Step 5: Commit**

```bash
git add neon-schema.sql migrations/2026-06-24-entity-model.sql
git commit -m "feat(schema): phase 0.5 group/dealership/project tables + migration"
```

---

### Task 2: ID minting for `GRP-` and `DLR-`

**Files:**
- Modify: `lib/ids.ts`

**Interfaces:**
- Produces: `mintGroupId(): Promise<string>` → `GRP-000007`; `mintDealershipId(): Promise<string>` → `DLR-000142`.

- [ ] **Step 1: Append to `lib/ids.ts`** (keep the existing `mintProjectId`):

```ts
// Persistent-entity IDs: no year, zero-padded to 6. Reuses the atomic counter.
async function mintEntityId(prefix: 'GRP' | 'DLR'): Promise<string> {
  const rows = (await sql`
    insert into project_counter (type_year, n)
    values (${prefix}, 1)
    on conflict (type_year) do update set n = project_counter.n + 1
    returning n
  `) as { n: number }[];
  return `${prefix}-${String(rows[0].n).padStart(6, '0')}`;
}

export const mintGroupId = () => mintEntityId('GRP');
export const mintDealershipId = () => mintEntityId('DLR');
```

- [ ] **Step 2: Verify build + mint** — pushed at end of Task 4 (no standalone UI yet). For now confirm it compiles by committing; the first real mint is exercised in Task 7.

- [ ] **Step 3: Commit**

```bash
git add lib/ids.ts
git commit -m "feat(ids): mint GRP-/DLR- persistent entity ids"
```

---

### Task 3: Dealer-group entity — lib + API

**Files:**
- Create: `lib/groups.ts`
- Create: `app/api/groups/route.ts`

**Interfaces:**
- Consumes: `sql` (`@/lib/db`), `mintGroupId` (`@/lib/ids`), `isAuthed`/`unauthorized` (`@/lib/security`).
- Produces: `createGroup`, `getGroup`, `getGroupByConversation`, `setGroupRefs`, `listGroups`; `GET/POST /api/groups`.

- [ ] **Step 1: Create `lib/groups.ts`**

```ts
import { sql } from '@/lib/db';
import { mintGroupId } from '@/lib/ids';

export interface DealerGroup {
  id: string;
  name: string;
  billing_email: string | null;
  portal_group_id: string | null;
  outlook_conversation_id: string | null;
  substate: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export async function createGroup(input: {
  name: string;
  billing_email?: string | null;
  portal_group_id?: string | null;
  outlook_conversation_id?: string | null;
}): Promise<DealerGroup> {
  const id = await mintGroupId();
  const rows = (await sql`
    insert into dealer_group (id, name, billing_email, portal_group_id, outlook_conversation_id)
    values (${id}, ${input.name}, ${input.billing_email || null},
            ${input.portal_group_id || null}, ${input.outlook_conversation_id || null})
    returning *
  `) as DealerGroup[];
  return rows[0];
}

export async function getGroup(id: string): Promise<DealerGroup | null> {
  const rows = (await sql`select * from dealer_group where id = ${id}`) as DealerGroup[];
  return rows[0] || null;
}

export async function getGroupByConversation(conversationId: string): Promise<DealerGroup | null> {
  const rows = (await sql`
    select * from dealer_group where outlook_conversation_id = ${conversationId} limit 1
  `) as DealerGroup[];
  return rows[0] || null;
}

export async function setGroupRefs(
  id: string,
  refs: Partial<Pick<DealerGroup, 'portal_group_id' | 'outlook_conversation_id' | 'billing_email'>>
): Promise<DealerGroup | null> {
  const rows = (await sql`
    update dealer_group set
      portal_group_id = coalesce(${refs.portal_group_id ?? null}::text, portal_group_id),
      outlook_conversation_id = coalesce(${refs.outlook_conversation_id ?? null}::text, outlook_conversation_id),
      billing_email = coalesce(${refs.billing_email ?? null}::text, billing_email),
      updated_at = now()
    where id = ${id}
    returning *
  `) as DealerGroup[];
  return rows[0] || null;
}

export async function listGroups(limit = 100): Promise<DealerGroup[]> {
  return (await sql`select * from dealer_group order by created_at desc limit ${limit}`) as DealerGroup[];
}
```

- [ ] **Step 2: Create `app/api/groups/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { isAuthed, unauthorized } from '@/lib/security';
import { createGroup, getGroup, listGroups } from '@/lib/groups';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  if (!(await isAuthed())) return unauthorized();
  const id = req.nextUrl.searchParams.get('id');
  if (id) return NextResponse.json({ ok: true, group: await getGroup(id) });
  return NextResponse.json({ ok: true, groups: await listGroups() });
}

export async function POST(req: NextRequest) {
  if (!(await isAuthed())) return unauthorized();
  try {
    const body = (await req.json()) as { name?: string; billing_email?: string; portal_group_id?: string };
    if (!body.name) return NextResponse.json({ ok: false, error: 'name is required.' }, { status: 400 });
    const group = await createGroup({
      name: body.name,
      billing_email: body.billing_email || null,
      portal_group_id: body.portal_group_id || null,
    });
    return NextResponse.json({ ok: true, group });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add lib/groups.ts app/api/groups/route.ts
git commit -m "feat(groups): dealer_group entity lib + api"
```

---

### Task 4: Dealership entity — lib + API

**Files:**
- Create: `lib/dealerships.ts`
- Create: `app/api/dealerships/route.ts`

**Interfaces:**
- Consumes: `sql`, `mintDealershipId`, `isAuthed`/`unauthorized`.
- Produces: `createDealership`, `getDealership`, `findDealershipsByName`, `listDealershipsByGroup`, `setDealershipRefs`; `GET/POST /api/dealerships`.

- [ ] **Step 1: Create `lib/dealerships.ts`**

```ts
import { sql } from '@/lib/db';
import { mintDealershipId } from '@/lib/ids';

export interface Dealership {
  id: string;
  group_id: string | null;
  name: string;
  dms: string | null;
  conduit: string | null;
  oems: string[];
  portal_dealer_id: string | null;
  status: string;
  substate: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export async function createDealership(input: {
  name: string;
  group_id?: string | null;
  dms?: string | null;
  conduit?: string | null;
  oems?: string[];
  portal_dealer_id?: string | null;
  status?: string;
}): Promise<Dealership> {
  const id = await mintDealershipId();
  const rows = (await sql`
    insert into dealership (id, group_id, name, dms, conduit, oems, portal_dealer_id, status)
    values (
      ${id}, ${input.group_id || null}, ${input.name}, ${input.dms || null}, ${input.conduit || null},
      ${JSON.stringify(input.oems || [])}::jsonb, ${input.portal_dealer_id || null},
      ${input.status || 'prospect'}
    )
    returning *
  `) as Dealership[];
  return rows[0];
}

export async function getDealership(id: string): Promise<Dealership | null> {
  const rows = (await sql`select * from dealership where id = ${id}`) as Dealership[];
  return rows[0] || null;
}

export async function findDealershipsByName(name: string): Promise<Dealership[]> {
  return (await sql`
    select * from dealership where lower(name) = lower(${name}) order by created_at desc
  `) as Dealership[];
}

export async function listDealershipsByGroup(groupId: string): Promise<Dealership[]> {
  return (await sql`select * from dealership where group_id = ${groupId} order by created_at asc`) as Dealership[];
}

export async function listDealerships(limit = 100): Promise<Dealership[]> {
  return (await sql`select * from dealership order by created_at desc limit ${limit}`) as Dealership[];
}

export async function setDealershipRefs(
  id: string,
  refs: Partial<Pick<Dealership, 'portal_dealer_id' | 'group_id' | 'dms' | 'conduit' | 'status'>>
): Promise<Dealership | null> {
  const rows = (await sql`
    update dealership set
      portal_dealer_id = coalesce(${refs.portal_dealer_id ?? null}::text, portal_dealer_id),
      group_id = coalesce(${refs.group_id ?? null}::text, group_id),
      dms = coalesce(${refs.dms ?? null}::text, dms),
      conduit = coalesce(${refs.conduit ?? null}::text, conduit),
      status = coalesce(${refs.status ?? null}::text, status),
      updated_at = now()
    where id = ${id}
    returning *
  `) as Dealership[];
  return rows[0] || null;
}
```

- [ ] **Step 2: Create `app/api/dealerships/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { isAuthed, unauthorized } from '@/lib/security';
import { createDealership, getDealership, listDealerships, listDealershipsByGroup } from '@/lib/dealerships';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  if (!(await isAuthed())) return unauthorized();
  const sp = req.nextUrl.searchParams;
  const id = sp.get('id');
  const groupId = sp.get('groupId');
  if (id) return NextResponse.json({ ok: true, dealership: await getDealership(id) });
  if (groupId) return NextResponse.json({ ok: true, dealerships: await listDealershipsByGroup(groupId) });
  return NextResponse.json({ ok: true, dealerships: await listDealerships() });
}

export async function POST(req: NextRequest) {
  if (!(await isAuthed())) return unauthorized();
  try {
    const b = (await req.json()) as {
      name?: string; group_id?: string; dms?: string; conduit?: string;
      oems?: string[]; portal_dealer_id?: string;
    };
    if (!b.name) return NextResponse.json({ ok: false, error: 'name is required.' }, { status: 400 });
    const dealership = await createDealership({
      name: b.name,
      group_id: b.group_id || null,
      dms: b.dms || null,
      conduit: b.conduit || null,
      oems: Array.isArray(b.oems) ? b.oems : [],
      portal_dealer_id: b.portal_dealer_id || null,
    });
    return NextResponse.json({ ok: true, dealership });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
```

- [ ] **Step 3: Commit & push (first build check of Tasks 2–4)**

```bash
git add lib/dealerships.ts app/api/dealerships/route.ts
git commit -m "feat(dealerships): dealership entity lib + api"
git push origin main
```
Verify: Vercel build goes green.

---

### Task 5: Refactor `project` to reference a dealership

**Files:**
- Modify: `lib/projects.ts`
- Modify: `app/api/projects/route.ts`

**Interfaces:**
- Consumes: `Dealership` type, `getDealership`.
- Produces: `Project` (now with `dealership_id`, no dealer fields); `createProject({type, dealership_id})`; `findProjectsByDealership`; `getProjectsByDealership`. `POST /api/projects` now requires `dealership_id`.

- [ ] **Step 1: Replace `lib/projects.ts`** with the dealership-referencing version:

```ts
import { sql } from '@/lib/db';
import { mintProjectId, type ProjectType } from '@/lib/ids';

export interface Project {
  id: string;
  type: ProjectType;
  dealership_id: string | null;
  status: string;
  substate: Record<string, unknown>;
  outlook_conversation_id: string | null;
  clickup_task_id: string | null;
  created_at: string;
  updated_at: string;
  ended_at: string | null;
}

export async function createProject(input: { type: ProjectType; dealership_id: string }): Promise<Project> {
  const id = await mintProjectId(input.type);
  const rows = (await sql`
    insert into project (id, type, dealership_id)
    values (${id}, ${input.type}, ${input.dealership_id})
    returning *
  `) as Project[];
  return rows[0];
}

export async function getProject(id: string): Promise<Project | null> {
  const rows = (await sql`select * from project where id = ${id}`) as Project[];
  return rows[0] || null;
}

export async function getProjectsByDealership(dealershipId: string): Promise<Project[]> {
  return (await sql`
    select * from project where dealership_id = ${dealershipId} order by created_at desc
  `) as Project[];
}

// Dedup: existing projects of a type for a dealership (warn before minting a duplicate engagement).
export async function findProjectsByDealership(dealershipId: string, type: ProjectType): Promise<Project[]> {
  return (await sql`
    select * from project where dealership_id = ${dealershipId} and type = ${type} order by created_at desc
  `) as Project[];
}

export async function getProjectByConversation(conversationId: string): Promise<Project | null> {
  const rows = (await sql`
    select * from project where outlook_conversation_id = ${conversationId} limit 1
  `) as Project[];
  return rows[0] || null;
}

export async function listProjects(limit = 100): Promise<Project[]> {
  return (await sql`select * from project order by created_at desc limit ${limit}`) as Project[];
}

export async function setProjectRefs(
  id: string,
  refs: Partial<Pick<Project, 'clickup_task_id' | 'outlook_conversation_id' | 'status'>>
): Promise<Project | null> {
  const rows = (await sql`
    update project set
      clickup_task_id = coalesce(${refs.clickup_task_id ?? null}::text, clickup_task_id),
      outlook_conversation_id = coalesce(${refs.outlook_conversation_id ?? null}::text, outlook_conversation_id),
      status = coalesce(${refs.status ?? null}::text, status),
      updated_at = now()
    where id = ${id}
    returning *
  `) as Project[];
  return rows[0] || null;
}
```

- [ ] **Step 2: Replace the POST handler logic in `app/api/projects/route.ts`** to require `dealership_id` and dedup by dealership. Full file:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { isAuthed, unauthorized } from '@/lib/security';
import { isProjectType } from '@/lib/ids';
import {
  createProject, getProject, getProjectByConversation, findProjectsByDealership, listProjects,
} from '@/lib/projects';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  if (!(await isAuthed())) return unauthorized();
  const sp = req.nextUrl.searchParams;
  const id = sp.get('id');
  const conversationId = sp.get('conversationId');
  if (id) return NextResponse.json({ ok: true, project: await getProject(id) });
  if (conversationId) return NextResponse.json({ ok: true, project: await getProjectByConversation(conversationId) });
  return NextResponse.json({ ok: true, projects: await listProjects() });
}

export async function POST(req: NextRequest) {
  if (!(await isAuthed())) return unauthorized();
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const type = body.type;
  const dealership_id = body.dealership_id as string | undefined;
  if (!isProjectType(type)) {
    return NextResponse.json(
      { ok: false, error: 'type must be onboarding | support | warranty_uplift | investigation' },
      { status: 400 }
    );
  }
  if (!dealership_id) {
    return NextResponse.json({ ok: false, error: 'dealership_id is required.' }, { status: 400 });
  }
  const force = body.force === true;
  try {
    if (!force) {
      const dupes = await findProjectsByDealership(dealership_id, type);
      if (dupes.length > 0) return NextResponse.json({ ok: false, duplicate: dupes });
    }
    const project = await createProject({ type, dealership_id });
    return NextResponse.json({ ok: true, project });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
```

- [ ] **Step 3: Commit & push**

```bash
git add lib/projects.ts app/api/projects/route.ts
git commit -m "refactor(project): reference dealership_id; dedup per dealership"
git push origin main
```
Verify: Vercel build green.

---

### Task 6: Chain reverse-lookup (thread → group/dealership/projects)

**Files:**
- Create: `app/api/resolve/route.ts` (composes existing lib functions — no lib changes needed)

**Interfaces:**
- Consumes: `getGroupByConversation`, `listDealershipsByGroup`, `getProjectByConversation`, `getDealership`, `getProjectsByDealership`.
- Produces: `GET /api/resolve?conversationId=…` → `{ ok, kind, group?, dealerships?, project?, dealership?, projects? }`.

- [ ] **Step 1: Create `app/api/resolve/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { isAuthed, unauthorized } from '@/lib/security';
import { getGroupByConversation, listGroups } from '@/lib/groups';
import { listDealershipsByGroup, getDealership } from '@/lib/dealerships';
import { getProjectByConversation, getProjectsByDealership } from '@/lib/projects';

export const runtime = 'nodejs';

// Resolve a thread to its entity chain. A group deal thread -> group + its dealerships +
// their projects. A single-engagement thread -> the project + its dealership.
export async function GET(req: NextRequest) {
  if (!(await isAuthed())) return unauthorized();
  const conversationId = req.nextUrl.searchParams.get('conversationId');
  if (!conversationId) {
    return NextResponse.json({ ok: false, error: 'conversationId required.' }, { status: 400 });
  }
  try {
    const group = await getGroupByConversation(conversationId);
    if (group) {
      const dealerships = await listDealershipsByGroup(group.id);
      return NextResponse.json({ ok: true, kind: 'group', group, dealerships });
    }
    const project = await getProjectByConversation(conversationId);
    if (project) {
      const dealership = project.dealership_id ? await getDealership(project.dealership_id) : null;
      const siblings = dealership ? await getProjectsByDealership(dealership.id) : [project];
      return NextResponse.json({ ok: true, kind: 'project', project, dealership, projects: siblings });
    }
    return NextResponse.json({ ok: true, kind: 'none' });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
```

- [ ] **Step 2: Commit & push**

```bash
git add app/api/resolve/route.ts
git commit -m "feat(resolve): thread -> group/dealership/project chain lookup"
git push origin main
```
Verify: Vercel build green.

---

### Task 7: Internal page — group/dealership create + views, dealership-based project mint, chain lookup

**Files:**
- Modify: `app/page.tsx`

**Interfaces:**
- Consumes: `/api/groups`, `/api/dealerships`, `/api/projects` (now needs `dealership_id`), `/api/resolve`.

This task updates the `Dashboard` component. The login/auth shell is unchanged. The acceptance wiring rows (portal/clickup/outlook) are unchanged. The changes: (a) a Group create + list panel, (b) a Dealership create panel (group optional, oems, portal_dealer_id, dms/conduit) + list, (c) the project-mint panel now selects a dealership instead of typing dealer fields, (d) the reverse-lookup now calls `/api/resolve` and renders the chain.

- [ ] **Step 1: Add state + loaders** to the `Dashboard` component (near the existing `useState` block). Add:

```tsx
  // entity state
  const [groups, setGroups] = useState<any[]>([]);
  const [dealerships, setDealerships] = useState<any[]>([]);
  const [groupName, setGroupName] = useState('');
  const [dlrName, setDlrName] = useState('');
  const [dlrGroupId, setDlrGroupId] = useState('');
  const [dlrDms, setDlrDms] = useState('');
  const [dlrConduit, setDlrConduit] = useState('');
  const [dlrOems, setDlrOems] = useState('');
  const [dlrPortalId, setDlrPortalId] = useState('');
  const [projDealershipId, setProjDealershipId] = useState('');
  const [chain, setChain] = useState<any | null>(null);

  async function loadEntities() {
    const [g, d] = await Promise.all([
      fetch('/api/groups').then((x) => x.json()),
      fetch('/api/dealerships').then((x) => x.json()),
    ]);
    if (g.ok) setGroups(g.groups || []);
    if (d.ok) setDealerships(d.dealerships || []);
  }
  useEffect(() => { loadEntities(); }, []);
```

- [ ] **Step 2: Add create handlers** (place beside the existing `createProject`):

```tsx
  async function createGroupFn() {
    const r = await fetch('/api/groups', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: groupName }),
    }).then((x) => x.json());
    if (r.ok) { setGroupName(''); loadEntities(); }
  }

  async function createDealershipFn() {
    const oems = dlrOems.split(',').map((s) => s.trim()).filter(Boolean);
    const r = await fetch('/api/dealerships', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: dlrName, group_id: dlrGroupId || null, dms: dlrDms || null,
        conduit: dlrConduit || null, oems, portal_dealer_id: dlrPortalId || null,
      }),
    }).then((x) => x.json());
    if (r.ok) {
      setDlrName(''); setDlrDms(''); setDlrConduit(''); setDlrOems(''); setDlrPortalId('');
      setProjDealershipId(r.dealership.id);
      loadEntities();
    }
  }

  async function resolveChain(conversationIdValue: string) {
    const r = await fetch(`/api/resolve?conversationId=${encodeURIComponent(conversationIdValue)}`).then((x) => x.json());
    setChain(r.ok ? r : { kind: 'error', error: r.error });
  }
```

- [ ] **Step 3: Replace the `createProject` handler** so it sends `dealership_id` (not dealer fields):

```tsx
  async function createProject(force = false) {
    setCreateMsg('Minting…');
    setDupe(null);
    if (!projDealershipId) { setCreateMsg('✗ Pick a dealership first.'); return; }
    try {
      const res = await fetch('/api/projects', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, dealership_id: projDealershipId, force }),
      });
      const j = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
      if (j.ok) { setCreateMsg(`✓ Minted ${j.project.id}`); setProjectId(j.project.id); loadProjects(); }
      else if (j.duplicate) { setCreateMsg(''); setDupe(j.duplicate); }
      else setCreateMsg(`✗ ${j.error || 'Failed.'}`);
    } catch (e: any) { setCreateMsg(`✗ ${e.message || 'Request failed.'}`); }
  }
```

- [ ] **Step 4: Add the Group + Dealership panels** to the JSX, immediately before the existing "1 · Create a project" card:

```tsx
      {/* Groups */}
      <div style={S.card}>
        <h2 style={S.h2}>A · Dealer groups</h2>
        <div style={S.row}>
          <div style={{ flex: '1 1 260px' }}>
            <label style={S.label}>Group name</label>
            <input style={S.input} value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="e.g. Phil Long" />
          </div>
          <button style={S.btn} onClick={createGroupFn}>Create group</button>
        </div>
        {groups.length > 0 && (
          <div style={{ marginTop: 12, ...S.mono, fontSize: 13 }}>
            {groups.map((g) => (
              <div key={g.id} style={{ cursor: 'pointer' }} onClick={() => setDlrGroupId(g.id)}>
                <span style={{ color: '#6ea8fe' }}>{g.id}</span> {g.name}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Dealerships */}
      <div style={S.card}>
        <h2 style={S.h2}>B · Dealerships (the first-class unit)</h2>
        <div style={S.row}>
          <div style={{ flex: '1 1 220px' }}>
            <label style={S.label}>Name</label>
            <input style={S.input} value={dlrName} onChange={(e) => setDlrName(e.target.value)} placeholder="Phil Long Hyundai of Chapel Hills" />
          </div>
          <div style={{ flex: '1 1 160px' }}>
            <label style={S.label}>Group ID (optional)</label>
            <input style={{ ...S.input, ...S.mono }} value={dlrGroupId} onChange={(e) => setDlrGroupId(e.target.value)} placeholder="GRP-000007" />
          </div>
          <div style={{ flex: '1 1 110px' }}>
            <label style={S.label}>DMS</label>
            <input style={S.input} value={dlrDms} onChange={(e) => setDlrDms(e.target.value)} placeholder="CDK" />
          </div>
          <div style={{ flex: '1 1 110px' }}>
            <label style={S.label}>Conduit</label>
            <input style={S.input} value={dlrConduit} onChange={(e) => setDlrConduit(e.target.value)} placeholder="fortellis" />
          </div>
          <div style={{ flex: '1 1 160px' }}>
            <label style={S.label}>OEMs (comma-sep)</label>
            <input style={S.input} value={dlrOems} onChange={(e) => setDlrOems(e.target.value)} placeholder="Hyundai" />
          </div>
          <div style={{ flex: '1 1 200px' }}>
            <label style={S.label}>Portal dealer ID</label>
            <input style={{ ...S.input, ...S.mono }} value={dlrPortalId} onChange={(e) => setDlrPortalId(e.target.value)} placeholder="seed_0" />
          </div>
          <button style={S.btn} onClick={createDealershipFn}>Create dealership</button>
        </div>
        {dealerships.length > 0 && (
          <div style={{ marginTop: 12, ...S.mono, fontSize: 13, lineHeight: 1.7 }}>
            {dealerships.slice(0, 10).map((d) => (
              <div key={d.id} style={{ cursor: 'pointer' }} onClick={() => setProjDealershipId(d.id)}>
                <span style={{ color: '#37c871' }}>{d.id}</span> {d.name}
                <span style={{ color: '#7e8ca8' }}> {Array.isArray(d.oems) ? d.oems.join('/') : ''} {d.group_id ? `· ${d.group_id}` : ''}</span>
              </div>
            ))}
          </div>
        )}
      </div>
```

- [ ] **Step 5: Replace the dealer-name/dms/conduit inputs in the "1 · Create a project" card** with a dealership picker. Replace that card's input row with:

```tsx
        <div style={S.row}>
          <div style={{ flex: '1 1 180px' }}>
            <label style={S.label}>Type</label>
            <select style={S.input} value={type} onChange={(e) => setType(e.target.value)}>
              {TYPES.map((t) => (<option key={t.v} value={t.v}>{t.label}</option>))}
            </select>
          </div>
          <div style={{ flex: '1 1 240px' }}>
            <label style={S.label}>Dealership ID (pick from list B)</label>
            <input style={{ ...S.input, ...S.mono }} value={projDealershipId} onChange={(e) => setProjDealershipId(e.target.value)} placeholder="DLR-000142" />
          </div>
          <button style={S.btn} onClick={() => createProject(false)}>Mint project</button>
        </div>
```

- [ ] **Step 6: Replace the reverse-lookup button + result** in the "2 · Acceptance test" card's section 5 to use the chain resolver:

```tsx
          <div style={S.row}>
            <div style={{ flex: '1 1 320px' }}>
              <input style={{ ...S.input, ...S.mono }} value={conversationId} onChange={(e) => setConversationId(e.target.value)} placeholder="conversationId" />
            </div>
            <button style={S.btnGhost} onClick={() => resolveChain(conversationId)}>Resolve chain</button>
          </div>
          {chain && (
            <div style={{ fontSize: 12, color: '#9db2d3', marginTop: 6, ...S.mono }}>
              {chain.kind === 'group' && (<div>Group {chain.group.id} ({chain.group.name}) → {chain.dealerships.length} dealership(s)</div>)}
              {chain.kind === 'project' && (<div>Project {chain.project.id} → dealership {chain.dealership?.id} ({chain.dealership?.name})</div>)}
              {chain.kind === 'none' && (<div>No entity linked to that conversationId.</div>)}
              {chain.kind === 'error' && (<div style={{ color: '#e5564b' }}>✗ {chain.error}</div>)}
            </div>
          )}
```

- [ ] **Step 7: Commit & push**

```bash
git add app/page.tsx
git commit -m "feat(page): group/dealership create + views, dealership-based project mint, chain lookup"
git push origin main
```

- [ ] **Step 8: Verify end-to-end on the deployed page** (after build green):
  1. Create group `Phil Long` → shows `GRP-000001`.
  2. Create dealership `Phil Long Hyundai of Chapel Hills`, group `GRP-000001`, dms `CDK`, conduit `fortellis`, oems `Hyundai`, portal dealer `seed_0` → shows `DLR-000002` (DLR-000001 is the migrated Steve Hahn).
  3. Mint an Onboarding project against `DLR-000002` → `ONB-2026-0002`.
  4. Tag an Outlook thread with that project (existing wiring), then **Resolve chain** on its conversationId → shows the project → dealership chain.

---

## Self-Review notes

- **Spec coverage:** entity model (Tasks 1,3,4,5) ✓; OEM as `oems[]` (Task 4) ✓; ID schemes GRP/DLR no-year + project year (Tasks 1,2) ✓; mappings portal/clickup/outlook — existing wiring routes unchanged, dealership/group carry the FKs (Tasks 3,4) ✓; chain reverse-lookup (Task 6) ✓; migration of the test row (Task 1) ✓; page views (Task 7) ✓. Fortellis matching, lifecycle automation, and per-DMS deep-dives are **later phases (1/2/5)** and intentionally out of this plan.
- **Placeholder scan:** no TODO/TBD; all code shown.
- **Type consistency:** `Dealership.oems` is `string[]` (stored jsonb array); `createProject` takes `{type, dealership_id}` and the route enforces `dealership_id`; `setProjectRefs` drops the removed dealer fields. `resolveByConversation` logic lives in the route (no separate lib fn needed) — interface note in Task 6 mentions a lib fn but the implementation puts it in the route; that's intentional and self-contained.
