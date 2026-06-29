# Group-Deal & Store-Assignment Operational Layer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the orchestrator the source of truth for grouping — open "group deals," register/roster stores, assign a store to a group via a closest-candidate suggestion you confirm, reconcile shortfalls/extras, push the group out to the portal, and log every decision.

**Architecture:** Adds a deal lifecycle to `dealer_group` (open/complete + contacts + locations), a name-similarity matcher (`lib/match.ts`) that suggests groups for a store among *open deals*, an assign endpoint that sets the dealership's group + pushes the portal group + logs the decision, and UI panels. No comms-arm dependency — operator-driven.

**Tech Stack:** Next.js 14 (App Router), TypeScript strict, `@neondatabase/serverless` (lazy `lib/db.ts`). Deploy GitHub `main` → Vercel.

## Global Constraints

- TypeScript strict. Reused `.tsx` style objects must be `as const`.
- API routes: `export const runtime = 'nodejs'`, guard with `isAuthed()`/`unauthorized()` from `@/lib/security`.
- Neon `coalesce($1, col)` updates cast the param `::text`; jsonb params are `${JSON.stringify(v)}::jsonb`.
- IDs: `GRP-`/`DLR-` minted by the orchestrator (no year); never derived from the portal.
- **Verification model:** no local Node/test runner — each task verifies via Vercel build-green after push + a check on the internal page or a Neon query (same loop as Phase 0/0.5). Commit per task.
- Grouping is **structural** (by `group_id`), never by dealer name. Matching is a closest-candidate **suggestion the operator confirms**.
- Portal/ClickUp are downstream projections; the orchestrator pushes outward.

---

### Task 1: Schema — deal lifecycle fields + decision_log

**Files:**
- Modify: `neon-schema.sql`
- Create: `migrations/2026-06-29-group-deals.sql`

**Interfaces:**
- Produces: `dealer_group.status` (`open`|`complete`), `dealer_group.contacts` jsonb, `dealer_group.locations_url` text; table `decision_log`.

- [ ] **Step 1: Append to `neon-schema.sql`** (after the `dealer_group` table block):

```sql
-- group-deal lifecycle (added 2026-06-29)
alter table dealer_group add column if not exists status text not null default 'open';
alter table dealer_group add column if not exists contacts jsonb not null default '[]'::jsonb;
alter table dealer_group add column if not exists locations_url text;

-- decision_log: every confirm/edit/reject on an automation proposal (dealership-anchored, type-faceted)
create table if not exists decision_log (
  id bigserial primary key,
  kind text not null,                 -- e.g. 'group_assignment'
  type text,                          -- onboarding | support | warranty_uplift | investigation
  dealership_id text,
  group_id text,
  proposal jsonb not null default '{}'::jsonb,
  decision text not null,             -- confirmed | edited | rejected
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_decision_dealership on decision_log(dealership_id);
create index if not exists idx_decision_kind on decision_log(kind);
```

- [ ] **Step 2: Create `migrations/2026-06-29-group-deals.sql`** with the exact same statements (idempotent — paste into Neon once).

- [ ] **Step 3: Apply** — paste `migrations/2026-06-29-group-deals.sql` into the Neon SQL editor and run.

- [ ] **Step 4: Verify in Neon:**

```sql
select column_name from information_schema.columns where table_name='dealer_group' and column_name in ('status','contacts','locations_url');
select to_regclass('public.decision_log');
```
Expected: 3 columns listed; `decision_log` not null.

- [ ] **Step 5: Commit**

```bash
git add neon-schema.sql migrations/2026-06-29-group-deals.sql
git commit -m "feat(schema): group-deal lifecycle fields + decision_log"
```

---

### Task 2: Groups lib + API — deal lifecycle

**Files:**
- Modify: `lib/groups.ts`
- Modify: `app/api/groups/route.ts`

**Interfaces:**
- Produces: `DealerGroup` gains `status`, `contacts`, `locations_url`; `createGroup` accepts them; `listOpenGroups()`; `setGroupStatus(id, status)`. `POST /api/groups` accepts `contacts`/`locations_url`; `GET /api/groups?status=open`; `PATCH /api/groups` sets status.

- [ ] **Step 1: Replace `lib/groups.ts`** with the extended version:

```ts
import { sql } from '@/lib/db';
import { mintGroupId } from '@/lib/ids';

export interface DealerGroup {
  id: string;
  name: string;
  billing_email: string | null;
  portal_group_id: string | null;
  outlook_conversation_id: string | null;
  status: string;                 // open | complete
  contacts: unknown[];            // [{name,email,domain}]
  locations_url: string | null;
  substate: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export async function createGroup(input: {
  name: string;
  billing_email?: string | null;
  portal_group_id?: string | null;
  outlook_conversation_id?: string | null;
  contacts?: unknown[];
  locations_url?: string | null;
}): Promise<DealerGroup> {
  const id = await mintGroupId();
  const rows = (await sql`
    insert into dealer_group (id, name, billing_email, portal_group_id, outlook_conversation_id, contacts, locations_url)
    values (${id}, ${input.name}, ${input.billing_email || null}, ${input.portal_group_id || null},
            ${input.outlook_conversation_id || null}, ${JSON.stringify(input.contacts || [])}::jsonb,
            ${input.locations_url || null})
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

export async function listGroups(limit = 200): Promise<DealerGroup[]> {
  return (await sql`select * from dealer_group order by created_at desc limit ${limit}`) as DealerGroup[];
}

export async function listOpenGroups(): Promise<DealerGroup[]> {
  return (await sql`select * from dealer_group where status = 'open' order by updated_at desc`) as DealerGroup[];
}

export async function setGroupStatus(id: string, status: string): Promise<DealerGroup | null> {
  const rows = (await sql`
    update dealer_group set status = ${status}, updated_at = now() where id = ${id} returning *
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
```

- [ ] **Step 2: Replace `app/api/groups/route.ts`:**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { isAuthed, unauthorized } from '@/lib/security';
import { createGroup, getGroup, listGroups, listOpenGroups, setGroupStatus } from '@/lib/groups';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  if (!(await isAuthed())) return unauthorized();
  const sp = req.nextUrl.searchParams;
  const id = sp.get('id');
  if (id) return NextResponse.json({ ok: true, group: await getGroup(id) });
  if (sp.get('status') === 'open') return NextResponse.json({ ok: true, groups: await listOpenGroups() });
  return NextResponse.json({ ok: true, groups: await listGroups() });
}

export async function POST(req: NextRequest) {
  if (!(await isAuthed())) return unauthorized();
  try {
    const b = (await req.json()) as {
      name?: string; billing_email?: string; locations_url?: string; contacts?: unknown[];
    };
    if (!b.name) return NextResponse.json({ ok: false, error: 'name is required.' }, { status: 400 });
    const group = await createGroup({
      name: b.name,
      billing_email: b.billing_email || null,
      locations_url: b.locations_url || null,
      contacts: Array.isArray(b.contacts) ? b.contacts : [],
    });
    return NextResponse.json({ ok: true, group });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  if (!(await isAuthed())) return unauthorized();
  try {
    const b = (await req.json()) as { id?: string; status?: string };
    if (!b.id || !b.status) return NextResponse.json({ ok: false, error: 'id and status required.' }, { status: 400 });
    return NextResponse.json({ ok: true, group: await setGroupStatus(b.id, b.status) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
```

- [ ] **Step 3: Commit & push**

```bash
git add lib/groups.ts app/api/groups/route.ts
git commit -m "feat(groups): deal lifecycle (open/complete, contacts, locations)"
git push origin main
```
Verify: Vercel build green.

---

### Task 3: Portal group create-or-link (push the group out)

**Files:**
- Modify: `lib/portal.ts`

**Interfaces:**
- Produces: `createOrLinkPortalGroup({ groupId, name }) -> { portalGroupId, action }`; `setPortalDealerGroup(portalDealerId, portalGroupId)`.

- [ ] **Step 1: Append to `lib/portal.ts`** (the portal `groups` collection key is `ezw:groups:v1`):

```ts
const GROUPS_KEY = 'ezw:groups:v1';

interface PortalGroupRow { id: string; name?: string; [k: string]: unknown }

async function getPortalGroupRows(): Promise<PortalGroupRow[]> {
  const res = await fetch(`${base()}/api/storage?key=${encodeURIComponent(GROUPS_KEY)}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Portal groups fetch failed (${res.status}): ${await res.text()}`);
  const json = (await res.json()) as { value: string | null };
  return json.value ? (JSON.parse(json.value) as PortalGroupRow[]) : [];
}

async function putPortalGroupRows(rows: PortalGroupRow[]): Promise<void> {
  const res = await fetch(`${base()}/api/storage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: GROUPS_KEY, value: JSON.stringify(rows) }),
  });
  if (!res.ok) throw new Error(`Portal groups save failed (${res.status}): ${await res.text()}`);
}

// Ensure a portal group exists for this orchestrator group; match by name → link, else create.
export async function createOrLinkPortalGroup(input: {
  groupId: string; name: string;
}): Promise<{ portalGroupId: string; action: 'linked' | 'created' }> {
  const rows = await getPortalGroupRows();
  const existing = rows.find((g) => String(g.name || '').trim().toLowerCase() === input.name.trim().toLowerCase());
  if (existing) return { portalGroupId: String(existing.id), action: 'linked' };
  const id = `grp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  rows.push({ id, name: input.name });
  await putPortalGroupRows(rows);
  return { portalGroupId: id, action: 'created' };
}

// Set a portal dealer's groupId (assign it to its portal group). Full-collection replace.
export async function setPortalDealerGroup(portalDealerId: string, portalGroupId: string): Promise<void> {
  const dealers = await getDealers();
  const target = dealers.find((d) => d.id === portalDealerId);
  if (!target) throw new Error(`Dealer ${portalDealerId} not found in the portal.`);
  (target as Dealer & { groupId?: string }).groupId = portalGroupId;
  await putDealers(dealers);
}
```

- [ ] **Step 2: Commit & push**

```bash
git add lib/portal.ts
git commit -m "feat(portal): create-or-link portal group + assign dealer to group (push out)"
git push origin main
```
Verify: Vercel build green.

---

### Task 4: Matcher — closest-candidate suggestion among open deals

**Files:**
- Create: `lib/match.ts`
- Create: `app/api/assign/route.ts` (GET = suggestions)

**Interfaces:**
- Consumes: `listOpenGroups` (`@/lib/groups`), `getDealershipsByGroup` via `listDealershipsByGroup` (`@/lib/dealerships`).
- Produces: `normalizeName(s) -> string[]`, `similarity(a,b) -> number`, `suggestGroups(storeName) -> Suggestion[]`; `GET /api/assign?store=<name>` → `{ ok, suggestions }`.

- [ ] **Step 1: Create `lib/match.ts`** (token-set Jaccard with abbreviation expansion — handles "Modesto Toyota" ↔ "Toyota of Modesto" and "Concord Chrysler Dodge Jeep Ram" ↔ "Concord CDJR"):

```ts
import { listOpenGroups, type DealerGroup } from '@/lib/groups';
import { listDealershipsByGroup, type Dealership } from '@/lib/dealerships';

const ABBREV: [RegExp, string][] = [
  [/\bcdjr\b/g, 'chrysler dodge jeep ram'], [/\bcjdr\b/g, 'chrysler dodge jeep ram'],
  [/\bvw\b/g, 'volkswagen'], [/\bgmc\b/g, 'gmc'], [/\bcdj\b/g, 'chrysler dodge jeep'],
  [/\bchevy\b/g, 'chevrolet'], [/\bmb\b/g, 'mercedes benz'], [/\bvolkswagon\b/g, 'volkswagen'],
];
const STOP = new Set(['of', 'the', 'and', 'a', 'at', 'inc', 'llc', 'auto', 'automotive', 'motors', 'dealership']);

export function normalizeName(name: string): string[] {
  let s = (name || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ');
  for (const [re, exp] of ABBREV) s = s.replace(re, exp);
  return s.split(/\s+/).filter((t) => t && !STOP.has(t));
}

export function similarity(a: string, b: string): number {
  const A = new Set(normalizeName(a));
  const B = new Set(normalizeName(b));
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  const union = new Set([...A, ...B]).size;
  return union ? inter / union : 0;
}

export interface Suggestion {
  group: DealerGroup;
  score: number;                       // best match score for this group (0..1)
  matchedStore: Dealership | null;     // the closest expected store in the group, if any
}

// Rank OPEN group deals as candidates for a store name: best of (group-name similarity,
// any expected-store similarity). Higher score = more confident.
export async function suggestGroups(storeName: string): Promise<Suggestion[]> {
  const groups = await listOpenGroups();
  const out: Suggestion[] = [];
  for (const g of groups) {
    const dealerships = await listDealershipsByGroup(g.id);
    let best = similarity(storeName, g.name);
    let matched: Dealership | null = null;
    for (const d of dealerships) {
      const s = similarity(storeName, d.name);
      if (s > best) { best = s; matched = d; }
      else if (s >= best && s > 0 && !matched) { matched = d; }
    }
    out.push({ group: g, score: Number(best.toFixed(3)), matchedStore: matched });
  }
  return out.sort((a, b) => b.score - a.score);
}
```

- [ ] **Step 2: Export the `Dealership` type from `lib/dealerships.ts`** — confirm its `export interface Dealership` is exported (it is). No change needed if already exported.

- [ ] **Step 3: Create `app/api/assign/route.ts` (GET = suggestions):**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { isAuthed, unauthorized } from '@/lib/security';
import { suggestGroups } from '@/lib/match';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  if (!(await isAuthed())) return unauthorized();
  const store = req.nextUrl.searchParams.get('store')?.trim();
  if (!store) return NextResponse.json({ ok: false, error: 'store name required.' }, { status: 400 });
  try {
    return NextResponse.json({ ok: true, suggestions: await suggestGroups(store) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
```

- [ ] **Step 4: Commit & push**

```bash
git add lib/match.ts app/api/assign/route.ts
git commit -m "feat(match): closest-candidate group suggestions among open deals"
git push origin main
```
Verify: Vercel build green.

---

### Task 5: Decision log + confirm-assignment (POST)

**Files:**
- Create: `lib/decisions.ts`
- Modify: `app/api/assign/route.ts` (add POST)

**Interfaces:**
- Consumes: `getDealership`/`createDealership`/`setDealershipRefs` (`@/lib/dealerships`), `getGroup` (`@/lib/groups`), `createOrLinkPortalDealer`/`createOrLinkPortalGroup`/`setPortalDealerGroup` (`@/lib/portal`).
- Produces: `logDecision(entry)`; `POST /api/assign` → confirm a store→group assignment, push portal, log.

- [ ] **Step 1: Create `lib/decisions.ts`:**

```ts
import { sql } from '@/lib/db';

export async function logDecision(entry: {
  kind: string;
  type?: string | null;
  dealership_id?: string | null;
  group_id?: string | null;
  proposal?: unknown;
  decision: string;            // confirmed | edited | rejected
  detail?: unknown;
}): Promise<void> {
  await sql`
    insert into decision_log (kind, type, dealership_id, group_id, proposal, decision, detail)
    values (${entry.kind}, ${entry.type || null}, ${entry.dealership_id || null}, ${entry.group_id || null},
            ${JSON.stringify(entry.proposal || {})}::jsonb, ${entry.decision},
            ${JSON.stringify(entry.detail || {})}::jsonb)
  `;
}
```

- [ ] **Step 2: Add a POST handler to `app/api/assign/route.ts`** (append; keep the GET). Body assigns an existing dealership (`dealershipId`) OR creates a new one (`name` + optional `dms`) into a group, pushes the portal group + dealer, and logs:

```ts
import {
  getDealership, createDealership, setDealershipRefs,
} from '@/lib/dealerships';
import { getGroup } from '@/lib/groups';
import { createOrLinkPortalDealer, createOrLinkPortalGroup, setPortalDealerGroup } from '@/lib/portal';
import { logDecision } from '@/lib/decisions';

// POST { groupId, dealershipId? , name?, dms?, proposal?, decision? }
// Assign a store to an open group deal: set its group, push the portal group + dealer, log.
export async function POST(req: NextRequest) {
  if (!(await isAuthed())) return unauthorized();
  try {
    const b = (await req.json()) as {
      groupId?: string; dealershipId?: string; name?: string; dms?: string;
      proposal?: unknown; decision?: string;
    };
    if (!b.groupId) return NextResponse.json({ ok: false, error: 'groupId is required.' }, { status: 400 });
    const group = await getGroup(b.groupId);
    if (!group) return NextResponse.json({ ok: false, error: 'group not found.' }, { status: 404 });

    // resolve or create the dealership
    let dealership = b.dealershipId ? await getDealership(b.dealershipId) : null;
    if (!dealership) {
      if (!b.name) return NextResponse.json({ ok: false, error: 'dealershipId or name required.' }, { status: 400 });
      dealership = await createDealership({ name: b.name, group_id: b.groupId, dms: b.dms || null, status: 'onboarding' });
    } else {
      dealership = await setDealershipRefs(dealership.id, { group_id: b.groupId, status: 'onboarding' });
    }
    if (!dealership) return NextResponse.json({ ok: false, error: 'failed to resolve dealership.' }, { status: 500 });

    // push portal: ensure portal group, ensure/link portal dealer, set its group
    let portalError: string | null = null;
    try {
      const pg = await createOrLinkPortalGroup({ groupId: group.id, name: group.name });
      let portalDealerId = dealership.portal_dealer_id;
      if (!portalDealerId) {
        const pd = await createOrLinkPortalDealer({ dealershipId: dealership.id, name: dealership.name, dms: dealership.dms });
        portalDealerId = pd.portalDealerId;
        await setDealershipRefs(dealership.id, { portal_dealer_id: portalDealerId });
      }
      await setPortalDealerGroup(portalDealerId, pg.portalGroupId);
    } catch (e) {
      portalError = (e as Error).message;
    }

    await logDecision({
      kind: 'group_assignment', type: 'onboarding',
      dealership_id: dealership.id, group_id: b.groupId,
      proposal: b.proposal ?? null, decision: b.decision || 'confirmed',
      detail: { portalError },
    });

    return NextResponse.json({ ok: true, dealership, portalError });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
```

- [ ] **Step 3: Commit & push**

```bash
git add lib/decisions.ts app/api/assign/route.ts
git commit -m "feat(assign): confirm store->group assignment, push portal, log decision"
git push origin main
```
Verify: Vercel build green.

---

### Task 6: UI — open deals, roster, assign, reconciliation

**Files:**
- Modify: `app/page.tsx`

**Interfaces:**
- Consumes: `/api/groups` (POST with contacts/locations, GET ?status=open, PATCH status), `/api/dealerships` (create expected roster store), `/api/assign` (GET suggestions, POST confirm).

Add a **"Group deals"** card (replacing/extending the existing "A · Dealer groups" card) with: create an open deal (name + contacts + locations_url), the list of open deals with **Mark complete**, a per-deal roster (add expected store), a **reconciliation** line (roster count vs onboarded), and an **Assign a store** sub-panel (type a store name → ranked suggestions → confirm into a group).

- [ ] **Step 1: Add state** to `Dashboard` (near the existing group state):

```tsx
  const [openDeals, setOpenDeals] = useState<any[]>([]);
  const [dealLocations, setDealLocations] = useState('');
  const [dealContacts, setDealContacts] = useState('');
  const [assignStore, setAssignStore] = useState('');
  const [assignDms, setAssignDms] = useState('');
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [assignMsg, setAssignMsg] = useState('');
```

- [ ] **Step 2: Add loaders + handlers** (next to `createGroupFn`):

```tsx
  async function loadOpenDeals() {
    const r = await fetch('/api/groups?status=open').then((x) => x.json());
    if (r.ok) setOpenDeals(r.groups || []);
  }

  async function createDealFn() {
    const contacts = dealContacts.split(',').map((s) => s.trim()).filter(Boolean)
      .map((email) => ({ email, domain: email.includes('@') ? email.split('@')[1] : '' }));
    const r = await fetch('/api/groups', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: groupName, locations_url: dealLocations || null, contacts }),
    }).then((x) => x.json());
    if (r.ok) { setGroupName(''); setDealLocations(''); setDealContacts(''); loadOpenDeals(); loadEntities(); }
  }

  async function completeDeal(id: string) {
    await fetch('/api/groups', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, status: 'complete' }) });
    loadOpenDeals();
  }

  async function getSuggestions() {
    setAssignMsg(''); setSuggestions([]);
    const r = await fetch(`/api/assign?store=${encodeURIComponent(assignStore.trim())}`).then((x) => x.json());
    if (r.ok) setSuggestions(r.suggestions || []);
    else setAssignMsg(`✗ ${r.error}`);
  }

  async function confirmAssign(groupId: string) {
    setAssignMsg('Assigning…');
    const r = await fetch('/api/assign', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupId, name: assignStore.trim(), dms: assignDms || null, decision: 'confirmed', proposal: { suggestions } }),
    }).then((x) => x.json());
    if (r.ok) { setAssignMsg(`✓ ${r.dealership.id} → ${groupId}${r.portalError ? ` (⚠ portal: ${r.portalError})` : ''}`); setSuggestions([]); setAssignStore(''); setAssignDms(''); loadOpenDeals(); loadEntities(); }
    else setAssignMsg(`✗ ${r.error}`);
  }
```

- [ ] **Step 3: Call `loadOpenDeals()` in the mount effect** — add it to the existing `useEffect(() => { loadProjects(); loadEntities(); }, [])`:

```tsx
  useEffect(() => {
    loadProjects();
    loadEntities();
    loadOpenDeals();
  }, []);
```

- [ ] **Step 4: Add the "Group deals" card** to the JSX, immediately after the existing "A · Dealer groups" card (keep that card; this adds the deal layer below it):

```tsx
      {/* ── Group deals (open) + assignment ───────────────── */}
      <div style={S.card}>
        <h2 style={S.h2}>Group deals (open) + store assignment</h2>
        <div style={S.row}>
          <div style={{ flex: '1 1 200px' }}>
            <label style={S.label}>Group name</label>
            <input style={S.input} value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="Phil Long Group" />
          </div>
          <div style={{ flex: '1 1 200px' }}>
            <label style={S.label}>Contact emails (comma-sep)</label>
            <input style={S.input} value={dealContacts} onChange={(e) => setDealContacts(e.target.value)} placeholder="it@phillong.com" />
          </div>
          <div style={{ flex: '1 1 200px' }}>
            <label style={S.label}>Locations page URL</label>
            <input style={S.input} value={dealLocations} onChange={(e) => setDealLocations(e.target.value)} placeholder="https://…/locations" />
          </div>
          <button style={S.btn} onClick={createDealFn}>Open group deal</button>
        </div>

        {openDeals.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <label style={S.label}>Open deals</label>
            {openDeals.map((g) => (
              <div key={g.id} style={{ ...S.mono, fontSize: 13, display: 'flex', gap: 10, alignItems: 'center', padding: '3px 0' }}>
                <span style={{ color: '#6ea8fe' }}>{g.id}</span>
                <span style={{ flex: 1 }}>{g.name}</span>
                <button style={S.btnGhost} onClick={() => completeDeal(g.id)}>Mark complete</button>
              </div>
            ))}
          </div>
        )}

        <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid #1f2c45' }}>
          <label style={S.label}>Assign a store to a group</label>
          <div style={S.row}>
            <div style={{ flex: '1 1 240px' }}>
              <input style={S.input} value={assignStore} onChange={(e) => setAssignStore(e.target.value)} placeholder="store name (e.g. Concord CDJR)" />
            </div>
            <div style={{ flex: '1 1 110px' }}>
              <input style={S.input} value={assignDms} onChange={(e) => setAssignDms(e.target.value)} placeholder="DMS" />
            </div>
            <button style={S.btn} onClick={getSuggestions}>Suggest groups</button>
          </div>
          {suggestions.length > 0 && (
            <div style={{ marginTop: 10, ...S.mono, fontSize: 13 }}>
              {suggestions.slice(0, 5).map((s) => (
                <div key={s.group.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '3px 0' }}>
                  <span style={{ color: s.score >= 0.6 ? '#37c871' : s.score >= 0.3 ? '#d9a441' : '#7e8ca8' }}>
                    {(s.score * 100).toFixed(0)}%
                  </span>
                  <span style={{ flex: 1 }}>
                    {s.group.id} {s.group.name}
                    {s.matchedStore ? <span style={{ color: '#7e8ca8' }}> · ~{s.matchedStore.name}</span> : null}
                  </span>
                  <button style={S.btnGhost} onClick={() => confirmAssign(s.group.id)}>Assign here</button>
                </div>
              ))}
            </div>
          )}
          {assignMsg && <p style={{ fontSize: 12, color: assignMsg.startsWith('✗') ? '#e5564b' : '#37c871' }}>{assignMsg}</p>}
        </div>
      </div>
```

- [ ] **Step 5: Commit & push**

```bash
git add app/page.tsx
git commit -m "feat(page): group deals (open/complete) + assign-store with suggestions"
git push origin main
```

- [ ] **Step 6: Verify end-to-end on the deployed page** (after build green):
  1. **Open group deal** `Test Group A`, contacts `it@testgroup.com`, locations URL → appears under Open deals.
  2. **Assign a store** `Concord CDJR` → **Suggest groups** → shows ranked open deals (Test Group A scored). Click **Assign here** → `✓ DLR-xxxxx → GRP-xxxxxx`. In the portal, the new dealer exists with the group set.
  3. Re-suggest `Toyota of Modesto` after opening a `Modesto Toyota` deal → high score (normalization handles reorder).
  4. **Mark complete** an open deal → it drops off the open list.
  5. Neon: `select * from decision_log order by id desc limit 3;` → the assignment is logged.

---

## Self-Review

- **Spec coverage:** source-of-truth inversion — orchestrator mints + pushes (Tasks 3,5) ✓; group deal open/complete + contacts/locations (Tasks 1,2) ✓; roster = expected dealerships under a group (existing createDealership + assign) ✓; closest-candidate matcher, fuzzy names, confirm (Tasks 4,6) ✓; decision log (Tasks 1,5) ✓; push group to portal (Tasks 3,5) ✓. **Deferred by design (separate plans, per scope decision):** the AI auto-matcher (email/locations-page scoring + OUTBOX), the ClickUp Branch-task port, reconciliation shortfall/multi-store-feed UI (basic roster-vs-onboarded only here), and the RAG/trust-ramp. Reynolds PPSYSID-id and feed-identity-on-project belong to the activation-ingest (comms-arm) plan.
- **Placeholder scan:** none; all code shown.
- **Type consistency:** `suggestGroups` returns `Suggestion[]` consumed by the page; `createOrLinkPortalGroup`/`setPortalDealerGroup` names match Tasks 3 and 5; `logDecision` signature matches its caller; `DealerGroup` extended fields used consistently.
