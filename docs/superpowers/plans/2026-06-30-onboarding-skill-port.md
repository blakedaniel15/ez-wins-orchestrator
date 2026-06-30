# Onboarding-Skill Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the orchestrator drive the full onboarding lifecycle end-to-end — email sweep → classify → mint/stamp the universal IDs → detect region → create/advance ClickUp tasks → collect dealership users → send the right emails — by integrating the two existing form apps and absorbing the email assistant.

**Architecture:** Next.js 14 App Router on Vercel, Neon Postgres (lazy `sql` tagged-template in `lib/db.ts`), Upstash Redis (cadence state + admin sessions), MS Graph (read inbox + send), ClickUp v2 API, Anthropic API (classification + extraction + vision). Pure logic (region/brand/roster parsing) is unit-tested with vitest; integration is verified via `next build` green + Neon/ClickUp/portal checks. The orchestrator is the **source of truth**; it stamps its IDs onto tasks the forms/email create.

**Tech Stack:** TypeScript (strict), Next.js 14, `@neondatabase/serverless`, `@upstash/redis`, `@anthropic-ai/sdk`, `xlsx` (Excel parse), vitest.

## Global Constraints

- **Dealer ID (`DLR-`) is the one universal id** that travels through every system; project ids (`ONB-2026-NNNN`) are time-bound. Both get stamped onto every ClickUp task via resolve-by-name custom fields.
- **ClickUp lists (verbatim):** Feed Approval Pending `901113435718`; Companies Inbound `901105435045`; Support Requests `901106848667`; Followup/Planner `901111643961`.
- **ClickUp auth header is the RAW token** (not `Bearer ...`), env `CLICKUP_API_TOKEN`. Custom fields are per-space → **resolve by field NAME off the task**, env UUID is fallback only.
- **MOC Region** is a **plain-text** custom field named `MOC Region`, written in plain English (one of: `MOC NorCal`, `MOC SoCal`, `MOC PNW`, `MOC Central`, `MOC Mid-Atlantic`, `MOC Canada`, `Other Distributors`). Blake creates this text field on Companies Inbound + Warranty Submissions.
- **ClickUp task description format is a verbatim contract** parsed by the dev team's AI — copy the per-DMS formats exactly (fields, order, blank lines). `Door Rate: $225`, `Fluids Provider: MOC Products` always.
- **EZ Wins group naming:** the platform appends "Group" — store/send group names WITHOUT the trailing "Group".
- **Name casing:** ALL-CAPS feed names → Title Case for both task name and `Dealership Name:`.
- **Outbound is drafts-first** → everything routes through the OUTBOX (`action_queue`); "send" is an approved action. Real send via MS Graph is net-new (assistant only drafted) — verify Mail.Send.
- **MS Graph auth:** client-credentials, env `MS_TENANT_ID / MS_CLIENT_ID / MS_CLIENT_SECRET / MS_USER_EMAIL`.
- **Cutover:** comms arm replaces `ez-wins-email-assistant`; disable the assistant's crons before the orchestrator goes live — never both. (Low risk: the assistant "doesn't do a whole lot right now.")
- **No silent caps** — if a sweep/extraction bounds coverage, `log` what was dropped.
- Commit after every task. Push to `main` (auto-deploys to Vercel). Verify build green before moving on.

---

## File Structure

**New `lib/` modules (one responsibility each):**
- `lib/regions.ts` — `detectRegion(state, city)`, `STATE_TO_REGION`, the 7 region constants. Pure.
- `lib/brands.ts` — `detectBrand(name)`, `titleCase(name)`. Pure.
- `lib/descriptions.ts` — per-DMS ClickUp description builders (Fortellis/Reynolds/DealerVault/Tekion). Pure.
- `lib/graph.ts` — MS Graph: token, fetch inbox/thread, create draft, **sendMail** (ported + extended from the assistant).
- `lib/email.ts` — the three lifecycle emails + reach-back, built on `lib/graph.ts`.
- `lib/onboardingTask.ts` — `createOnboardingTask`, `completeTask`, `addComment` (ClickUp create/advance for onboarding).
- `lib/roster.ts` — the roster extractor: `extractRoster(input)` (typed/excel/text/vision), completeness matrix, missing-data routing.
- `lib/classify.ts` — Anthropic classifier (port the assistant prompt) → decision object.
- `lib/sweep.ts` — sweep loop: fetch → prefilter → classify → key by conversationId → dispatch.
- `lib/actions.ts` — the OUTBOX: enqueue/list/approve/edit/reject `action_queue` rows.
- `lib/cadence.ts` — generalized follow-up ladder (ported from `followups.js`).
- `lib/feeds.ts` — the 5 DMS feed parsers → normalized records.

**Extend existing:** `lib/dealerships.ts` (new columns), `lib/clickup.ts` (reuse field writers), `lib/portal.ts` (region + live), `lib/decisions.ts`.

**New API routes:** `app/api/onboarding/route.ts` (stage transitions), `app/api/roster/route.ts` (intake), `app/api/feeds/route.ts` (feed intake), `app/api/sweep/route.ts` (cron), `app/api/outbox/route.ts` (action queue), `app/api/cadence/route.ts` (cron).

**Migrations:** `migrations/2026-06-30-onboarding-port.sql`.

**Tests:** `tests/regions.test.ts`, `tests/brands.test.ts`, `tests/descriptions.test.ts`, `tests/roster.test.ts`, `tests/feeds.test.ts`.

---

## Phase 0 — Test harness + dependencies

### Task 0: Add vitest + xlsx + Anthropic SDK

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `tests/smoke.test.ts`

- [ ] **Step 1: Add deps**

```bash
cd /Users/blakedaniel/Projects/ez-wins-orchestrator
npm install -D vitest @vitejs/plugin-react
npm install @anthropic-ai/sdk xlsx
npm pkg set scripts.test="vitest run"
```

- [ ] **Step 2: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, '.') } },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
```

- [ ] **Step 3: Write a smoke test** — `tests/smoke.test.ts`

```ts
import { describe, it, expect } from 'vitest';
describe('harness', () => {
  it('runs', () => { expect(1 + 1).toBe(2); });
});
```

- [ ] **Step 4: Run it**

Run: `npm test`
Expected: PASS (1 test).

- [ ] **Step 5: Verify build still green**

Run: `npm run build`
Expected: compiles (vitest is dev-only, not bundled).

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "test: add vitest harness + xlsx + anthropic sdk"
```

---

## Phase A — Data model + region/brand + portal region

### Task A1: Migration — onboarding columns + new tables

**Files:**
- Create: `migrations/2026-06-30-onboarding-port.sql`
- Modify: `neon-schema.sql` (append the same, idempotent)

**Interfaces:**
- Produces: `dealership` columns `address, city, state, zip, region, brand, door_rate, platform_fields, lifecycle_stage, parts_users_onboarded`; tables `contact`, `roster_member`, `action_queue`, `cadence`.

- [ ] **Step 1: Write the migration**

```sql
-- migrations/2026-06-30-onboarding-port.sql  (idempotent; run once in Neon)
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
```

- [ ] **Step 2: Append the same statements to `neon-schema.sql`** (so a fresh DB is correct). Copy the block verbatim.

- [ ] **Step 3: Hand-off note** — this migration must be run by Blake in the orchestrator's Neon DB. Add a line to `STATUS.md` under "Pending migrations".

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(db): onboarding columns + contact/roster/action_queue/cadence tables"
```

### Task A2: Region detection (`lib/regions.ts`)

**Files:**
- Create: `lib/regions.ts`
- Test: `tests/regions.test.ts`
- Reference: `docs/reference/onboarding-skill/process_fortellis.py:169` (`detect_region`) for the rules.

**Interfaces:**
- Produces: `REGIONS` (string[]), `detectRegion(state: string, city: string): string` → a region or `'ASK'`.

- [ ] **Step 1: Write failing tests** — `tests/regions.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { detectRegion } from '@/lib/regions';

describe('detectRegion', () => {
  it('maps OR/WA/MT/ID to PNW', () => {
    expect(detectRegion('OR', 'Portland')).toBe('MOC PNW');
    expect(detectRegion('WA', 'Seattle')).toBe('MOC PNW');
  });
  it('maps CO/TX/WY/NM/OK/LA/MS to Central', () => {
    expect(detectRegion('TX', 'Houston')).toBe('MOC Central');
    expect(detectRegion('CO', 'Denver')).toBe('MOC Central');
  });
  it('maps NC/SC/VA/MD/WV to Mid-Atlantic', () => {
    expect(detectRegion('NC', 'Charlotte')).toBe('MOC Mid-Atlantic');
  });
  it('splits CA NorCal vs SoCal by city', () => {
    expect(detectRegion('CA', 'San Francisco')).toBe('MOC NorCal');
    expect(detectRegion('CA', 'Los Angeles')).toBe('MOC SoCal');
  });
  it('splits NV Reno vs Vegas', () => {
    expect(detectRegion('NV', 'Reno')).toBe('MOC NorCal');
    expect(detectRegion('NV', 'Las Vegas')).toBe('MOC SoCal');
  });
  it('returns ASK for ambiguous CA central valley', () => {
    expect(detectRegion('CA', 'Fresno')).toBe('ASK');
    expect(detectRegion('CA', 'Bakersfield')).toBe('ASK');
  });
  it('returns Other Distributors for GA/IN/AZ/UT/HI', () => {
    expect(detectRegion('GA', 'Atlanta')).toBe('Other Distributors');
    expect(detectRegion('UT', 'Logan')).toBe('Other Distributors');
  });
  it('returns ASK for unmapped state', () => {
    expect(detectRegion('ZZ', 'Nowhere')).toBe('ASK');
  });
  it('accepts full state names', () => {
    expect(detectRegion('Utah', 'Logan')).toBe('Other Distributors');
  });
});
```

- [ ] **Step 2: Run, verify fail** — `npm test tests/regions.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement `lib/regions.ts`** porting `process_fortellis.py:detect_region`:

```ts
export const REGIONS = [
  'MOC NorCal', 'MOC SoCal', 'MOC PNW', 'MOC Central',
  'MOC Mid-Atlantic', 'MOC Canada', 'Other Distributors',
] as const;

const FULL_TO_ABBR: Record<string, string> = {
  california: 'CA', nevada: 'NV', oregon: 'OR', washington: 'WA', montana: 'MT', idaho: 'ID',
  colorado: 'CO', texas: 'TX', wyoming: 'WY', 'new mexico': 'NM', oklahoma: 'OK', louisiana: 'LA',
  mississippi: 'MS', 'north carolina': 'NC', 'south carolina': 'SC', virginia: 'VA', maryland: 'MD',
  'west virginia': 'WV', georgia: 'GA', indiana: 'IN', arizona: 'AZ', utah: 'UT', hawaii: 'HI',
};

const STATE_TO_REGION: Record<string, string> = {
  OR: 'MOC PNW', WA: 'MOC PNW', MT: 'MOC PNW', ID: 'MOC PNW',
  CO: 'MOC Central', TX: 'MOC Central', WY: 'MOC Central', NM: 'MOC Central',
  OK: 'MOC Central', LA: 'MOC Central', MS: 'MOC Central',
  NC: 'MOC Mid-Atlantic', SC: 'MOC Mid-Atlantic', VA: 'MOC Mid-Atlantic',
  MD: 'MOC Mid-Atlantic', WV: 'MOC Mid-Atlantic',
};
const CANADA = new Set(['AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'ON', 'PE', 'QC', 'SK']);

// CA: NorCal = Bay Area & north (Salinas+); SoCal = LA & south. Central valley = ASK.
const CA_NORCAL = new Set(['san francisco', 'oakland', 'san jose', 'sacramento', 'salinas', 'santa rosa', 'berkeley', 'fremont', 'concord', 'modesto', 'stockton']);
const CA_SOCAL = new Set(['los angeles', 'san diego', 'irvine', 'anaheim', 'long beach', 'riverside', 'san bernardino', 'santa ana', 'pasadena', 'torrance']);
const CA_ASK = new Set(['fresno', 'bakersfield', 'visalia', 'merced', 'clovis']);

function abbr(state: string): string {
  const s = (state || '').trim();
  if (s.length === 2) return s.toUpperCase();
  return FULL_TO_ABBR[s.toLowerCase()] || s.toUpperCase();
}

export function detectRegion(state: string, city: string): string {
  const st = abbr(state);
  const c = (city || '').trim().toLowerCase();
  if (CANADA.has(st)) return 'MOC Canada';
  if (st === 'CA') {
    if (CA_ASK.has(c)) return 'ASK';
    if (CA_SOCAL.has(c)) return 'MOC SoCal';
    if (CA_NORCAL.has(c)) return 'MOC NorCal';
    return 'ASK';
  }
  if (st === 'NV') {
    if (c.includes('reno') || c.includes('sparks') || c.includes('carson')) return 'MOC NorCal';
    if (c.includes('vegas') || c.includes('henderson')) return 'MOC SoCal';
    return 'ASK';
  }
  if (STATE_TO_REGION[st]) return STATE_TO_REGION[st];
  const OTHER = new Set(['GA', 'IN', 'AZ', 'UT', 'HI', 'FL', 'OH', 'MI', 'PA', 'TN', 'KY', 'AL', 'MO', 'KS', 'NE', 'AR', 'SD', 'ND', 'MN', 'WI', 'IL', 'IA', 'NY', 'NJ', 'CT', 'MA', 'ME', 'NH', 'VT', 'RI', 'DE', 'AK']);
  if (OTHER.has(st)) return 'Other Distributors';
  return 'ASK';
}
```

- [ ] **Step 4: Run, verify pass** — `npm test tests/regions.test.ts` → PASS.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: region detection ported from process_fortellis"`

### Task A3: Brand detection + title-case (`lib/brands.ts`)

**Files:**
- Create: `lib/brands.ts`
- Test: `tests/brands.test.ts`
- Reference: `docs/reference/onboarding-skill/SKILL.md:587` (brand rules).

**Interfaces:**
- Produces: `detectBrand(name: string): string | null`, `titleCase(name: string): string`.

- [ ] **Step 1: Write failing tests** — `tests/brands.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { detectBrand, titleCase } from '@/lib/brands';

describe('detectBrand', () => {
  it('expands CDJR', () => { expect(detectBrand('Concord CDJR')).toBe('Chrysler, Dodge, Jeep, Ram'); });
  it('expands VW', () => { expect(detectBrand('Dublin VW')).toBe('Volkswagen'); });
  it('joins multiple brands', () => { expect(detectBrand('DeMontrond Buick GMC')).toBe('Buick, GMC'); });
  it('returns null when none found', () => { expect(detectBrand('Sunrise Auto Group')).toBeNull(); });
});
describe('titleCase', () => {
  it('fixes ALL CAPS', () => { expect(titleCase('MOON TOWNSHIP HONDA')).toBe('Moon Township Honda'); });
  it('leaves mixed case alone', () => { expect(titleCase('Toyota of Modesto')).toBe('Toyota of Modesto'); });
});
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement `lib/brands.ts`:**

```ts
const ABBREV: [RegExp, string][] = [
  [/\bcdjr\b/i, 'Chrysler, Dodge, Jeep, Ram'],
  [/\bcjdr\b/i, 'Chrysler, Dodge, Jeep, Ram'],
  [/\bcdj\b/i, 'Chrysler, Dodge, Jeep'],
  [/\bvw\b/i, 'Volkswagen'],
];
const MARQUES = ['Chevrolet', 'Buick', 'GMC', 'Cadillac', 'Ford', 'Lincoln', 'Toyota', 'Honda', 'Nissan', 'Hyundai', 'Kia', 'Subaru', 'Mazda', 'Volkswagen', 'Audi', 'BMW', 'Mercedes-Benz', 'Lexus', 'Acura', 'Infiniti', 'Jeep', 'Dodge', 'Ram', 'Chrysler', 'Volvo', 'Porsche', 'Genesis', 'Mitsubishi'];

export function detectBrand(name: string): string | null {
  const n = name || '';
  for (const [re, exp] of ABBREV) if (re.test(n)) return exp;
  const found = MARQUES.filter((m) => new RegExp(`\\b${m.replace('-', '[- ]?')}\\b`, 'i').test(n));
  return found.length ? found.join(', ') : null;
}

export function titleCase(name: string): string {
  const s = name || '';
  // Only re-case if it's effectively all-caps; preserve mixed-case names.
  if (s !== s.toUpperCase()) return s;
  const small = new Set(['of', 'the', 'and', 'at', 'in', 'on', 'for']);
  return s.toLowerCase().split(/\s+/).map((w, i) =>
    small.has(w) && i > 0 ? w : w.charAt(0).toUpperCase() + w.slice(1)
  ).join(' ');
}
```

- [ ] **Step 4: Run, verify pass.**

- [ ] **Step 5: Commit** — `git commit -am "feat: brand detection + title-casing"`

### Task A4: Dealership model + create form capture address/region

**Files:**
- Modify: `lib/dealerships.ts` (extend `Dealership`, `createDealership`, `setDealershipRefs`)
- Modify: `app/api/dealerships/route.ts` (accept new fields; auto-detect region)
- Modify: `app/page.tsx` (B · Dealerships form: address inputs; show detected region)

**Interfaces:**
- Consumes: `detectRegion` (A2).
- Produces: `Dealership` gains `address, city, state, zip, region, brand, door_rate, platform_fields, lifecycle_stage, parts_users_onboarded`; `createDealership` accepts them; new `setDealershipOnboarding(id, fields)`.

- [ ] **Step 1: Extend the `Dealership` interface and `createDealership`** in `lib/dealerships.ts` — add the new optional inputs and columns to the insert. Add to the interface:

```ts
  address: string | null; city: string | null; state: string | null; zip: string | null;
  region: string | null; brand: string | null; door_rate: string;
  platform_fields: Record<string, unknown>; lifecycle_stage: string; parts_users_onboarded: boolean;
```

Extend `createDealership` input + insert columns: `address, city, state, zip, region, brand, platform_fields` (default `'{}'::jsonb`), `lifecycle_stage` default `'pending'`.

- [ ] **Step 2: Add `setDealershipOnboarding`** to `lib/dealerships.ts`:

```ts
export async function setDealershipOnboarding(
  id: string,
  f: Partial<Pick<Dealership, 'address'|'city'|'state'|'zip'|'region'|'brand'|'lifecycle_stage'|'parts_users_onboarded'>> & { platform_fields?: Record<string, unknown> }
): Promise<Dealership | null> {
  const rows = (await sql`
    update dealership set
      address = coalesce(${f.address ?? null}::text, address),
      city = coalesce(${f.city ?? null}::text, city),
      state = coalesce(${f.state ?? null}::text, state),
      zip = coalesce(${f.zip ?? null}::text, zip),
      region = coalesce(${f.region ?? null}::text, region),
      brand = coalesce(${f.brand ?? null}::text, brand),
      lifecycle_stage = coalesce(${f.lifecycle_stage ?? null}::text, lifecycle_stage),
      parts_users_onboarded = coalesce(${f.parts_users_onboarded ?? null}::boolean, parts_users_onboarded),
      platform_fields = coalesce(${f.platform_fields ? JSON.stringify(f.platform_fields) : null}::jsonb, platform_fields),
      updated_at = now()
    where id = ${id} returning *
  `) as Dealership[];
  return rows[0] || null;
}
```

- [ ] **Step 3: Wire region auto-detect in `app/api/dealerships/route.ts`** — on create, if `state` present, set `region = detectRegion(state, city)` (store `'ASK'` as-is for the review queue); set `brand = detectBrand(name)` when blank.

- [ ] **Step 4: Add address inputs + region display to `app/page.tsx`** B · Dealerships form (street/city/state/zip; show the computed region after create).

- [ ] **Step 5: Verify** — `npm run build` green; push; in the live page create a test dealer with a CA Bay-Area address → confirm `region = MOC NorCal` in Neon (`select name, region from dealership order by created_at desc limit 1`).

- [ ] **Step 6: Commit** — `git commit -am "feat: dealership captures address + auto-detects region/brand"`

### Task A5: Push region + lifecycle to the portal dealer

**Files:**
- Modify: `lib/portal.ts` (add `setPortalDealerRegion`, `setPortalDealerStatus`)
- Modify: `app/api/dealerships/route.ts` (push region on create)

**Interfaces:**
- Produces: `setPortalDealerRegion(portalDealerId, region)`, `setPortalDealerStatus(portalDealerId, status)` — full-collection-replace pattern (match the existing `setPortalDealerGroup`).

- [ ] **Step 1: Implement both** in `lib/portal.ts`, mirroring `setPortalDealerGroup` (fetch dealers, mutate `region` / `status`, `putDealers`).

```ts
export async function setPortalDealerRegion(portalDealerId: string, region: string): Promise<void> {
  const dealers = await getDealers();
  const t = dealers.find((d) => d.id === portalDealerId);
  if (!t) throw new Error(`Dealer ${portalDealerId} not found in the portal.`);
  (t as any).region = region;
  await putDealers(dealers);
}
export async function setPortalDealerStatus(portalDealerId: string, status: string): Promise<void> {
  const dealers = await getDealers();
  const t = dealers.find((d) => d.id === portalDealerId);
  if (!t) throw new Error(`Dealer ${portalDealerId} not found in the portal.`);
  (t as any).status = status;
  await putDealers(dealers);
}
```

- [ ] **Step 2: Call `setPortalDealerRegion`** after the dealer is created/linked in `app/api/dealerships/route.ts` (best-effort try/catch, like the existing portal push).

- [ ] **Step 3: Verify** — build green; create a dealer with an address → confirm the portal dealer shows the region (the bug Blake saw is fixed).

- [ ] **Step 4: Commit** — `git commit -am "feat: push region + status to portal dealer"`

---

## Phase B — Onboarding task builder + 3-stage lifecycle (manual buttons first)

### Task B1: Per-DMS description builders (`lib/descriptions.ts`)

**Files:**
- Create: `lib/descriptions.ts`
- Test: `tests/descriptions.test.ts`
- Reference: `docs/reference/onboarding-skill/SKILL.md:77,129,229,349` (the four exact formats).

**Interfaces:**
- Produces: `buildDescription(dms: DescInput): string`. `DescInput = { platform: 'Fortellis'|'Reynolds'|'DealerVault'|'Tekion', name, brand, owner, address, city, state, zip, dms, platform_fields }`.

- [ ] **Step 1: Write failing tests** asserting the **exact** strings (field order, blank lines, `Door Rate: $225`, `Fluids Provider: MOC Products`). One test per platform. Example for Reynolds:

```ts
import { describe, it, expect } from 'vitest';
import { buildDescription } from '@/lib/descriptions';

it('Reynolds format is verbatim', () => {
  const out = buildDescription({
    platform: 'Reynolds', name: 'Scarborough Toyota', brand: 'Toyota', owner: 'Scarborough Toyota',
    address: '1 Main St', city: 'Scarborough', state: 'ME', zip: '04074', dms: 'Reynolds',
    platform_fields: { ppsysid: '713042', store_code: '0431', historical_file_delivered: '' },
  });
  expect(out).toContain('API Platform: Reynolds');
  expect(out).toContain('DMS: Reynolds');
  expect(out).toContain('Reynolds PPSYSID: 713042');
  expect(out).toContain('Reynolds Store Code: 0431');
  expect(out).toContain('Door Rate: $225');
  expect(out).toContain('Fluids Provider: MOC Products');
});
```

Add DealerVault test asserting `DMS: <underlying>` is present (e.g. `DMS: DealerTrack`) **and** `DealerVault ID:`.

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement `lib/descriptions.ts`** — one builder function per platform, copying the formats from SKILL.md verbatim (the four code blocks at the referenced lines). Owner defaults to the dealership name when independent. Use `'\n'` joins matching the blank-line layout.

- [ ] **Step 4: Run, verify pass.**

- [ ] **Step 5: Commit** — `git commit -am "feat: per-DMS ClickUp description builders (verbatim format)"`

### Task B2: ClickUp onboarding-task ops (`lib/onboardingTask.ts`)

**Files:**
- Create: `lib/onboardingTask.ts`
- Modify: `lib/clickup.ts` (export `writeMocRegionField`, `createTask`, `completeTask`, `addComment`, `attachFile` helpers)

**Interfaces:**
- Consumes: `buildDescription` (B1), existing `writeProjectIdField`/`writeDealerIdField` (`lib/clickup.ts`).
- Produces: `createOnboardingTask({ dealership, projectId, listId }): Promise<{ taskId: string }>`; `completeOnboardingTask(taskId)`; `addMocRegion(taskId, region)`.

- [ ] **Step 1: Add low-level ClickUp helpers to `lib/clickup.ts`:**

```ts
export async function createTask(listId: string, body: { name: string; description: string; task_type?: string; tags?: string[] }): Promise<string> {
  const res = await fetch(`${CLICKUP_BASE}/list/${listId}/task`, {
    method: 'POST', headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`ClickUp create task failed (${res.status}): ${await res.text()}`);
  return ((await res.json()) as { id: string }).id;
}
export async function setTaskStatus(taskId: string, status: string): Promise<void> {
  const res = await fetch(`${CLICKUP_BASE}/task/${taskId}`, {
    method: 'PUT', headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) throw new Error(`ClickUp status update failed (${res.status}): ${await res.text()}`);
}
export async function addComment(taskId: string, text: string): Promise<void> {
  const res = await fetch(`${CLICKUP_BASE}/task/${taskId}/comment`, {
    method: 'POST', headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ comment_text: text }),
  });
  if (!res.ok) throw new Error(`ClickUp comment failed (${res.status}): ${await res.text()}`);
}
export async function writeMocRegionField(taskId: string, region: string): Promise<void> {
  const task = await getTask(taskId);
  if (!task) throw new Error(`Task ${taskId} not found.`);
  const fid = fieldIdByName(task, 'MOC Region', process.env.CLICKUP_MOC_REGION_FIELD_UUID);
  if (!fid) throw new Error(`No 'MOC Region' field on task ${taskId}'s space — create the text field.`);
  await postFieldValue(taskId, fid, region);
}
```

- [ ] **Step 2: Implement `lib/onboardingTask.ts`:**

```ts
import { createTask, setTaskStatus, addComment, writeProjectIdField, writeDealerIdField, writeMocRegionField } from '@/lib/clickup';
import { buildDescription } from '@/lib/descriptions';
import { titleCase } from '@/lib/brands';
import type { Dealership } from '@/lib/dealerships';

const PLATFORM_BY_CONDUIT: Record<string, 'Fortellis'|'Reynolds'|'DealerVault'|'Tekion'> = {
  fortellis: 'Fortellis', reynolds_rci: 'Reynolds', dealervault: 'DealerVault', tekion: 'Tekion',
};

export async function createOnboardingTask(input: {
  dealership: Dealership; projectId: string; listId: string; ownerGroupName?: string | null;
}): Promise<{ taskId: string }> {
  const d = input.dealership;
  const platform = PLATFORM_BY_CONDUIT[d.conduit || ''] || 'Fortellis';
  const description = buildDescription({
    platform, name: titleCase(d.name), brand: d.brand || '', owner: input.ownerGroupName || titleCase(d.name),
    address: d.address || '', city: d.city || '', state: d.state || '', zip: d.zip || '',
    dms: d.dms || '', platform_fields: d.platform_fields || {},
  });
  const taskId = await createTask(input.listId, { name: titleCase(d.name), description, task_type: 'Branch' });
  await writeDealerIdField(taskId, d.id);
  await writeProjectIdField(taskId, input.projectId);
  if (d.region && d.region !== 'ASK') await writeMocRegionField(taskId, d.region);
  return { taskId };
}
export async function completeOnboardingTask(taskId: string): Promise<void> {
  await setTaskStatus(taskId, 'complete');
}
```

- [ ] **Step 3: Verify** — build green. (Integration tested in B3 against a real list.)

- [ ] **Step 4: Commit** — `git commit -am "feat: ClickUp onboarding task ops (create Branch + stamp ids + region)"`

### Task B3: Lifecycle route — Stage 1/2/3 transitions (`app/api/onboarding/route.ts`)

**Files:**
- Create: `app/api/onboarding/route.ts`
- Modify: `lib/decisions.ts` (reuse `logDecision`)

**Interfaces:**
- Consumes: `createOnboardingTask`, `completeOnboardingTask` (B2), `getDealership`/`setDealershipOnboarding` (A4), `getProjectsByDealership`/`createProject` (`lib/projects.ts`), `setPortalDealerStatus` (A5).
- Produces: POST `{ action: 'stage2'|'stage3', dealershipId, ...}`. Stage 1 already covered by existing dealership+project creation; this route adds promote (stage2) and go-live (stage3).

- [ ] **Step 1: Implement the route.** `stage2`: ensure an onboarding project exists (create if missing), complete the Feed Approval Pending task if `dealership.platform_fields.pending_task_id` is set, then `createOnboardingTask` on `901105435045`, store the returned `taskId` on the project (`setProjectRefs(projectId, { clickup_task_id })`), set `lifecycle_stage='inbound'`, and enqueue the Stage-2 MOC data-request email to the OUTBOX (Phase D wires the actual send; here just `logDecision` + leave a queued action stub). `stage3`: `completeOnboardingTask`, `setDealershipOnboarding(id, { lifecycle_stage:'live' })`, `setPortalDealerStatus(portal_dealer_id, 'live')`, enqueue the go-live email.

```ts
import { NextRequest, NextResponse } from 'next/server';
import { isAuthed, unauthorized } from '@/lib/security';
import { getDealership, setDealershipOnboarding } from '@/lib/dealerships';
import { getProjectsByDealership, createProject, setProjectRefs } from '@/lib/projects';
import { createOnboardingTask, completeOnboardingTask } from '@/lib/onboardingTask';
import { setPortalDealerStatus } from '@/lib/portal';
import { logDecision } from '@/lib/decisions';

export const runtime = 'nodejs';
const COMPANIES_INBOUND = '901105435045';

export async function POST(req: NextRequest) {
  if (!(await isAuthed())) return unauthorized();
  try {
    const b = await req.json() as { action: string; dealershipId: string };
    const d = await getDealership(b.dealershipId);
    if (!d) return NextResponse.json({ ok: false, error: 'dealership not found' }, { status: 404 });

    if (b.action === 'stage2') {
      let projects = await getProjectsByDealership(d.id);
      let proj = projects.find((p) => p.type === 'onboarding');
      if (!proj) proj = await createProject({ type: 'onboarding', dealership_id: d.id });
      const pendingTaskId = (d.platform_fields as any)?.pending_task_id as string | undefined;
      if (pendingTaskId) await completeOnboardingTask(pendingTaskId);
      const { taskId } = await createOnboardingTask({ dealership: d, projectId: proj.id, listId: COMPANIES_INBOUND });
      await setProjectRefs(proj.id, { clickup_task_id: taskId });
      await setDealershipOnboarding(d.id, { lifecycle_stage: 'inbound' });
      await logDecision({ kind: 'lifecycle', type: 'onboarding', dealership_id: d.id, decision: 'stage2', detail: { taskId } });
      return NextResponse.json({ ok: true, taskId, projectId: proj.id });
    }
    if (b.action === 'stage3') {
      await setDealershipOnboarding(d.id, { lifecycle_stage: 'live' });
      if (d.portal_dealer_id) await setPortalDealerStatus(d.portal_dealer_id, 'live');
      await logDecision({ kind: 'lifecycle', type: 'onboarding', dealership_id: d.id, decision: 'stage3', detail: {} });
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ ok: false, error: 'unknown action' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
```

- [ ] **Step 2: Add buttons to `app/page.tsx`** — on a dealership: "Stage 2: integration approved → create inbound task" and "Stage 3: complete → go live". Show the returned `taskId`.

- [ ] **Step 3: Verify (integration)** — build green; push. On the live page, create a Reynolds test dealer (address + `platform_fields` ppsysid/store_code) → Stage 2 → confirm a **Branch** task appears on Companies Inbound `901105435045` with the exact description, `MOC Region`, Dealer ID + project id set. Stage 3 → portal dealer flips to `live`.

- [ ] **Step 4: Commit** — `git commit -am "feat: onboarding lifecycle stage2/stage3 transitions + UI buttons"`

### Task B4: Recipients — capture request contacts, classify by domain

**Files:**
- Create: `lib/contacts.ts`
- Modify: `app/api/onboarding/route.ts` (accept contacts on stage1/stage2)
- Modify: `app/page.tsx` (contacts input)

**Interfaces:**
- Produces: `addContacts(input: { dealershipId?, groupId?, people: {name,email}[] })` — classifies each by email domain (`@ez-wins.com` and the MOC domain → `moc`, else `dealer`), inserts into `contact`. `listContacts(dealershipId, kind?)`.

- [ ] **Step 1: Implement `lib/contacts.ts`** with a `MOC_DOMAINS` set (`ez-wins.com`, `mocproducts.com`) → `kind='moc'`, else `dealer`; manual `kind` override honored if passed.

- [ ] **Step 2: Wire** — onboarding route accepts `contacts[]` and calls `addContacts`. Page form: a small contacts textarea (`name <email>` per line).

- [ ] **Step 3: Verify** — build green; add 2 contacts (one ez-wins, one dealer domain) → `select email, kind from contact order by id desc limit 2` shows correct classification.

- [ ] **Step 4: Commit** — `git commit -am "feat: capture + domain-classify request contacts"`

---

## Phase C — Comms arm (sweep → classify → OUTBOX) + cutover

> **Source to port from:** `/Users/blakedaniel/Projects/ez-wins-email-assistant` — `lib/graph.js`, `lib/followups.js`, `lib/email_assistant_prompt.md`, `api/email-sweep.js`. Copy these files into the orchestrator and adapt; do not import across repos.

### Task C1: MS Graph client (`lib/graph.ts`) — read + send

**Files:**
- Create: `lib/graph.ts` (port `ez-wins-email-assistant/lib/graph.js` + `api/email-sweep.js:69-167`)
- Create: `lib/signature.html` (copy from the assistant)

**Interfaces:**
- Produces: `getToken()`, `fetchRecentInbox(lookbackHours): Promise<Msg[]>`, `fetchThread(conversationId): Promise<Msg[]>`, `createDraftReply(messageId, body)`, `createOutboundDraft(to, subject, body)`, `sendMail({to, cc?, subject, html})`, `tagProcessed(messageId, categories)`. `Msg = { id, conversationId, subject, from, toRecipients, receivedDateTime, bodyPreview, body, hasAttachments }`.

- [ ] **Step 1: Port auth + read helpers** verbatim in TS (client-credentials token; `fetchRecentInbox` filters last N hours and excludes the `EZ-Assistant-Processed` category; `fetchThread` sorts client-side). Use `MS_USER_EMAIL`.

- [ ] **Step 2: Add `sendMail`** (NET-NEW — assistant never sent):

```ts
export async function sendMail(input: { to: string[]; cc?: string[]; subject: string; html: string }): Promise<void> {
  const token = await getToken();
  const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(process.env.MS_USER_EMAIL!)}/sendMail`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        subject: input.subject,
        body: { contentType: 'HTML', content: input.html },
        toRecipients: input.to.map((e) => ({ emailAddress: { address: e } })),
        ccRecipients: (input.cc || []).map((e) => ({ emailAddress: { address: e } })),
      }, saveToSentItems: true,
    }),
  });
  if (!res.ok) throw new Error(`Graph sendMail failed (${res.status}): ${await res.text()}`);
}
```

- [ ] **Step 3: Verify Mail.Send permission** — call `sendMail` once to `MS_USER_EMAIL` from a throwaway script route `app/api/_test-send/route.ts` (delete after). If it 403s, the Azure app needs `Mail.Send` application permission + admin consent. **Document the result in `STATUS.md`.** If unavailable, note the Resend fallback (`RESEND_API_KEY`) and proceed with drafts only.

- [ ] **Step 4: Commit** — `git commit -am "feat: MS Graph client (read inbox + send)"`

### Task C2: Classifier (`lib/classify.ts`)

**Files:**
- Create: `lib/classify.ts`
- Create: `lib/prompts/email_classify.md` (port `email_assistant_prompt.md`)

**Interfaces:**
- Produces: `classifyEmail(thread: Msg[]): Promise<Decision>` where `Decision = { email_type: 'dms_onboarding'|'integration_approval'|'support_request'|'investigation'|'warranty_request'|'other'; should_draft: boolean; is_onboarding_request: boolean; dms?: string; dealer_name?: string; moc_rep?: {name,email}; draft?: {subject,body}; reasoning: string }`.

- [ ] **Step 1: Copy the prompt** to `lib/prompts/email_classify.md`, and **extend** it with: (a) the `integration_approval` type with the four concrete signatures from `docs/reference/dms-samples/` (Fortellis "EZ Wins Activation Details", Reynolds "RCI Deployment Order Confirmation", Tekion "Integration Confirmed", DealerVault "Feed Activated"); (b) `investigation` + `warranty_request` types (classify-only for now).

- [ ] **Step 2: Implement `classifyEmail`** using `@anthropic-ai/sdk`, model `claude-opus-4-8`, system = the prompt file, user = the serialized thread; parse the JSON decision object (strip code fences; throw on invalid JSON so the sweep can retry).

- [ ] **Step 3: Write a test** with a captured integration-approval `.eml` body (read `docs/reference/dms-samples/fortellis/EZ Wins Activation Details.eml`) asserting `email_type === 'integration_approval'` and `dms` detected. (Mock the Anthropic call OR mark it `it.skip` if no key in CI — note: this is an integration test; run locally with `ANTHROPIC_API_KEY` set.)

- [ ] **Step 4: Verify** — build green; run the local classify test with a key.

- [ ] **Step 5: Commit** — `git commit -am "feat: email classifier (all 4 types + integration-approval detection)"`

### Task C3: OUTBOX / action queue (`lib/actions.ts` + `app/api/outbox/route.ts`)

**Files:**
- Create: `lib/actions.ts`
- Create: `app/api/outbox/route.ts`
- Modify: `app/page.tsx` (OUTBOX panel)

**Interfaces:**
- Consumes: `action_queue` table (A1).
- Produces: `enqueueAction({project_id?, conversation_id?, kind, proposed_payload})`, `listActions(state?)`, `decideAction(id, state, editedPayload?)`. GET `/api/outbox?state=pending`; POST `{ id, decision, payload? }`.

- [ ] **Step 1: Implement `lib/actions.ts`** (insert/select/update on `action_queue`; on `decideAction` to `approved|sent`, also `logDecision`).

- [ ] **Step 2: Implement the route** (GET list, POST decide). On `approved` for a `kind` that sends (`draft_reply`/`reach_back`/`send_welcome`), dispatch via `lib/email.ts` (Phase D) and set `state='sent'`.

- [ ] **Step 3: OUTBOX panel in `app/page.tsx`** — list pending actions with Approve / Edit / Reject.

- [ ] **Step 4: Verify** — build green; enqueue a test action via a Neon insert → it shows in the panel → Approve flips state.

- [ ] **Step 5: Commit** — `git commit -am "feat: OUTBOX action queue + UI"`

### Task C4: Cadence engine (`lib/cadence.ts` + `app/api/cadence/route.ts`)

**Files:**
- Create: `lib/cadence.ts` (port `ez-wins-email-assistant/lib/followups.js`)
- Create: `app/api/cadence/route.ts` (cron)
- Test: `tests/cadence.test.ts` (business-day math)

**Interfaces:**
- Produces: `nextDue(anchor: Date, step: number): Date` (CT business-day ladder: +2, +3, +3 bd → +7 cal → +3 bd → +5 bd), `tickCadence()` (advance due rows, enqueue the next nudge action, stop on reply/stage-advance).

- [ ] **Step 1: Write failing tests** for `nextDue` business-day math (e.g. anchor Friday + 2bd = Tuesday; skips weekends).

- [ ] **Step 2: Port the ladder math** from `followups.js:116-156` into `nextDue`; back the durable record with the `cadence` Neon table (keep Redis counters optional).

- [ ] **Step 3: Implement `tickCadence`** — for each `cadence` row with `next_due <= now` and no `stopped_reason`: enqueue the step's nudge to the OUTBOX, bump `step`/`next_due`; stop when the thread has a non-Blake reply or the project stage advanced.

- [ ] **Step 4: Cron route** `app/api/cadence/route.ts` (Bearer `CRON_SECRET`) calling `tickCadence`. Add to `vercel.json` (port the assistant's `30 14 * * 1-5`).

- [ ] **Step 5: Verify** — `npm test tests/cadence.test.ts` PASS; build green.

- [ ] **Step 6: Commit** — `git commit -am "feat: generalized cadence engine + cron"`

### Task C5: Sweep loop (`lib/sweep.ts` + `app/api/sweep/route.ts`)

**Files:**
- Create: `lib/sweep.ts`
- Create: `app/api/sweep/route.ts` (cron)
- Modify: `vercel.json` (port the sweep schedules)

**Interfaces:**
- Consumes: `fetchRecentInbox`/`fetchThread`/`tagProcessed` (C1), `classifyEmail` (C2), `enqueueAction` (C3), `getProjectByConversation`/`createProject` (`lib/projects.ts`), onboarding lifecycle helpers (B3).
- Produces: `runSweep(): Promise<{processed: number; byType: Record<string,number>}>`.

- [ ] **Step 1: Implement `runSweep`** — port `api/email-sweep.js` flow: fetch recent inbox (1.5h) minus processed; per email apply the prefilters (skip @ez-wins.com internal, noise/noreply, already-replied); `fetchThread`; `classifyEmail`; then **dispatch by type, keyed by conversationId → project**:
  - `dms_onboarding` → find/mint project by conversationId; create Feed Approval Pending task (`901113435718`) stamped with ids; capture MOC rep as a contact; start a `customer` cadence track.
  - `integration_approval` → match the project by dealer name/conversation; call the **stage2** path (complete pending → create inbound task).
  - `support_request`/`investigation`/`warranty_request` → create the task on its list (parity with the assistant) — classify-only depth for now.
  - any `should_draft` → `enqueueAction({kind:'draft_reply', ...})` (drafts-first).
  - tag the email processed with the outcome category.
- **No silent caps:** `log` the count fetched vs processed and any skipped.

- [ ] **Step 2: Cron route** `app/api/sweep/route.ts` (Bearer `CRON_SECRET`) → `runSweep`. Add the sweep crons to `vercel.json` (port the assistant's weekday/weekend schedule).

- [ ] **Step 3: Verify (integration)** — build green; trigger `POST /api/sweep` manually (with `CRON_SECRET`) against the live inbox → confirm it returns a processed count and pending actions appear in the OUTBOX, and a known onboarding email produced a Feed Approval Pending task stamped with a `DLR-`/`ONB-`.

- [ ] **Step 4: Commit** — `git commit -am "feat: email sweep loop + cron (classify → project → OUTBOX)"`

### Task C6: Cutover — retire the email assistant

**Files:**
- Modify: `STATUS.md` (record cutover)
- External: `ez-wins-email-assistant/vercel.json` (disable crons) — **Blake action**

- [ ] **Step 1: Parity check** — run `/api/sweep` for a full day's lookback; confirm onboarding intros, integration approvals, and support requests are all caught and produce the right tasks/drafts. List any misses in `STATUS.md`.

- [ ] **Step 2: Disable the assistant** — Blake removes/empties the `crons` array in `ez-wins-email-assistant/vercel.json` (or pauses the Vercel project) so only the orchestrator sweeps. **Never both** (double tasks/drafts). Record the date in `STATUS.md`.

- [ ] **Step 3: Commit** — `git commit -am "chore: cutover — orchestrator sweep replaces email assistant"`

---

## Phase D — Lifecycle emails (MS Graph real send via OUTBOX)

### Task D1: Email builders + send (`lib/email.ts`)

**Files:**
- Create: `lib/email.ts`
- Modify: `app/api/onboarding/route.ts` (enqueue Stage-2 + Stage-3 emails)
- Modify: `lib/actions.ts` (dispatch `send_*` kinds via `lib/email.ts`)

**Interfaces:**
- Consumes: `sendMail` (C1), `listContacts` (B4).
- Produces: `buildStage2Email(dealership, setupFormUrl)`, `buildStage3Email(dealership)`, `buildDealerEmail(dealership, rosterEmails)` → `{ to, cc?, subject, html }`. Sending is via the OUTBOX (drafts-first): these build payloads; `decideAction(approved)` calls `sendMail`.

- [ ] **Step 1: Implement the three builders** — Stage 2 → `to` = MOC contacts (`listContacts(id,'moc')`), body asks for the data + the per-dealership setup-form link (`${SETUP_FORM_BASE_URL}?dealer=${portal_dealer_id}`). Stage 3 → `to` = original request users (all contacts), go-live notice. Dealer → `to` = roster emails, fired by the parts-onboarded gate (E4).

- [ ] **Step 2: Enqueue, don't auto-send** — in the onboarding route, Stage 2/3 call `enqueueAction({ kind:'send_welcome'|'draft_reply', project_id, proposed_payload: emailPayload })`. The OUTBOX Approve dispatches `sendMail`.

- [ ] **Step 3: Wire `lib/actions.ts` dispatch** — on approve of a `send_*` action, call `sendMail(payload)` and set `state='sent'`.

- [ ] **Step 4: Verify (integration)** — build green; run Stage 2 on a test dealer → a pending "send" action appears in the OUTBOX with the right recipients + setup-form link → Approve → email arrives (if Mail.Send is granted; else it stays a draft).

- [ ] **Step 5: Commit** — `git commit -am "feat: lifecycle emails via MS Graph through the OUTBOX"`

---

## Phase E — Roster extractor (email-first)

### Task E1: Roster extraction core (`lib/roster.ts`)

**Files:**
- Create: `lib/roster.ts`
- Test: `tests/roster.test.ts`

**Interfaces:**
- Produces: `RosterRow = { name, email, role, dms_id, source, confidence, missing: string[], action }`; `extractFromText(text, source): Promise<RosterRow[]>` (AI), `extractFromExcel(buffer, source): RosterRow[]` (xlsx, deterministic first-pass + AI fallback), `extractFromImage(base64, source): Promise<RosterRow[]>` (vision), `applyCompleteness(row, underlyingDms): RosterRow`.

- [ ] **Step 1: Write failing tests for `applyCompleteness`** — the locked role×DMS matrix (`docs/superpowers/specs/2026-06-30-onboarding-skill-port-design.md` §6):

```ts
import { describe, it, expect } from 'vitest';
import { applyCompleteness } from '@/lib/roster';

it('manager missing email → reach_back', () => {
  const r = applyCompleteness({ name: 'A', email: '', role: 'manager', dms_id: '', source: 'email_text', confidence: 1, missing: [], action: 'none' }, 'CDK');
  expect(r.missing).toContain('email'); expect(r.action).toBe('reach_back');
});
it('advisor on CDK missing dms_id → internal_id_pull', () => {
  const r = applyCompleteness({ name: 'B', email: 'b@x.com', role: 'advisor', dms_id: '', source: 'email_text', confidence: 1, missing: [], action: 'none' }, 'CDK');
  expect(r.action).toBe('internal_id_pull');
});
it('advisor on Tekion missing dms_id → ignored (none)', () => {
  const r = applyCompleteness({ name: 'C', email: 'c@x.com', role: 'advisor', dms_id: '', source: 'email_text', confidence: 1, missing: [], action: 'none' }, 'Tekion');
  expect(r.action).toBe('none');
});
it('technician needs no email', () => {
  const r = applyCompleteness({ name: 'D', email: '', role: 'technician', dms_id: '5', source: 'email_text', confidence: 1, missing: [], action: 'none' }, 'CDK');
  expect(r.missing).not.toContain('email');
});
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement `applyCompleteness`** — encode the matrix: email required for manager/owner/gm/fod/advisor (missing → `reach_back`); dms_id needed only for advisor/technician on `CDK|Fortellis|DealerTrack` (missing → `internal_id_pull`, else `none`/ignored). ID-need keys off the **underlying dms**. Per-row.

- [ ] **Step 4: Implement `extractFromExcel`** with `xlsx` — parse rows, map header variants (`name/full name`, `email`, `role/title`, `id/dms id/advisor #`); handle the two-layout reality (freeform `Name email` lines + `ID | Name` table with blank separators) by detecting header rows. Confident rows commit; ambiguous rows get `confidence < 1`.

- [ ] **Step 5: Implement `extractFromText` + `extractFromImage`** via Anthropic (text → JSON rows; image → vision JSON rows), then run each through `applyCompleteness`.

- [ ] **Step 6: Run, verify pass** (the `applyCompleteness` tests; the AI extractors are integration-tested in E2).

- [ ] **Step 7: Commit** — `git commit -am "feat: roster extractor core + completeness matrix"`

### Task E2: Roster intake route + persistence (`app/api/roster/route.ts`)

**Files:**
- Create: `app/api/roster/route.ts`
- Modify: `lib/roster.ts` (add `saveRoster(projectId, rows)`)

**Interfaces:**
- Consumes: `extractFrom*` (E1), `roster_member` table (A1).
- Produces: POST (multipart or JSON) `{ projectId, source, text? , file? , underlyingDms }` → extract → `saveRoster` → returns rows + flagged (missing) ones. GET `?projectId=` lists roster.

- [ ] **Step 1: Implement `saveRoster`** (insert each row into `roster_member`).

- [ ] **Step 2: Implement the route** — accept pasted text, an uploaded Excel/CSV (parse with `extractFromExcel`), or a PNG (`extractFromImage`); run completeness with the dealership's underlying dms; persist; for rows with `action='reach_back'`, enqueue a single OUTBOX `reach_back` draft naming exactly who's missing an email.

- [ ] **Step 3: Verify (integration)** — build green; POST a small users Excel against a test project → `select name, role, action, missing from roster_member` shows correct rows + a `reach_back` action queued for any missing-email row.

- [ ] **Step 4: Commit** — `git commit -am "feat: roster intake route + persistence + reach-back"`

### Task E3: Email intake UI + sweep wiring

**Files:**
- Modify: `app/page.tsx` (Email intake panel: paste body / upload attachment against a dealership/project)
- Modify: `lib/sweep.ts` (when a swept onboarding thread carries a roster — body list or attachment — call the extractor)

**Interfaces:**
- Consumes: roster intake (E2).

- [ ] **Step 1: Email intake panel** — pick dealership/project, paste body or upload file, choose source; POST to `/api/roster`; show extracted rows + flags.

- [ ] **Step 2: Sweep wiring** — in `runSweep`, for onboarding-type threads with attachments or a user list in the body, download the attachment via Graph and call the extractor (source `email_attachment`/`email_text`/`email_image`); always keep the original attached to the ClickUp task.

- [ ] **Step 3: Verify** — build green; paste a body with 3 `Name email` lines → 3 roster rows persist.

- [ ] **Step 4: Commit** — `git commit -am "feat: email intake UI + sweep-fed roster extraction"`

### Task E4: Dealer-notification gate

**Files:**
- Modify: `app/api/onboarding/route.ts` (action `notify_dealer`)
- Modify: `app/page.tsx` (button "Parts & users onboarded → notify dealer")

**Interfaces:**
- Consumes: `buildDealerEmail` (D1), roster emails (E2), `setDealershipOnboarding` (A4).

- [ ] **Step 1: Implement `notify_dealer`** — set `parts_users_onboarded=true`; gather roster emails (`select email from roster_member where project_id=$ and email <> ''`); enqueue `buildDealerEmail` to the OUTBOX.

- [ ] **Step 2: Button** in `app/page.tsx`.

- [ ] **Step 3: Verify** — build green; with roster rows present, click the button → a dealer-notification "send" action with the roster recipients appears in the OUTBOX.

- [ ] **Step 4: Commit** — `git commit -am "feat: dealer-notification gate (parts & users onboarded)"`

---

## Phase F — Feed ingesters

### Task F1: Feed parsers (`lib/feeds.ts`)

**Files:**
- Create: `lib/feeds.ts`
- Test: `tests/feeds.test.ts`
- Reference: `docs/reference/onboarding-skill/SKILL.md` (paths C/D parse formats), `docs/reference/dms-samples/`.

**Interfaces:**
- Produces: `parseDealerVault(text): FeedRecord[]`, `parseTekion(text): FeedRecord[]`, `parseFortellisCsv(csv): FeedRecord[]`, `parseReynoldsFields(obj): FeedRecord`. `FeedRecord = { name, dms, conduit, platform_fields, address?, city?, state?, zip?, source }`.

- [ ] **Step 1: Write failing tests** — DealerVault tab-line → `{name, dealervault_id, underlying_dms}`; Tekion 8-line block → `{name, tekion_dealer_id}`. Use the exact sample shapes from SKILL.md:163-304.

```ts
import { describe, it, expect } from 'vitest';
import { parseDealerVault, parseTekion } from '@/lib/feeds';

it('parses a DealerVault line', () => {
  const r = parseDealerVault('Citrus Motors Ford KIA\tDVD39749\tDealerTrack\tService\tActive\t05/13/2026 2:09 AM\t05/13/2026 01:03 PM\t218\t05/12/2026\tDVV02003');
  expect(r[0].name).toBe('Citrus Motors Ford KIA');
  expect(r[0].platform_fields.dealervault_id).toBe('DVD39749');
  expect(r[0].platform_fields.underlying_dms).toBe('DealerTrack');
  expect(r[0].conduit).toBe('dealervault');
});
it('parses a Tekion 8-line block', () => {
  const block = ['Young Honda','youngautomotivegrouput_6837_0','EZ Wins','May 13 2026, 3:55 pm','1.0.0','Pending Onboarding','May 13 2026, 3:55 pm','May 13 2026, 3:55 pm'].join('\n');
  const r = parseTekion(block);
  expect(r[0].name).toBe('Young Honda');
  expect(r[0].platform_fields.tekion_dealer_id).toBe('youngautomotivegrouput_6837_0');
  expect(r[0].conduit).toBe('tekion');
});
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement the parsers** — DealerVault (tab split, fields 1/2/3), Tekion (group lines in 8s, lines 1+2), Fortellis CSV (port the relevant column extraction from `process_fortellis.py`), Reynolds (combine Store#+Branch# → store_code). Set `conduit` from source. Title-case names.

- [ ] **Step 4: Run, verify pass.**

- [ ] **Step 5: Commit** — `git commit -am "feat: DMS feed parsers (DealerVault/Tekion/Fortellis/Reynolds)"`

### Task F2: Feed intake route + review table

**Files:**
- Create: `app/api/feeds/route.ts`
- Modify: `app/page.tsx` (Feed intake + review table)

**Interfaces:**
- Consumes: `parse*` (F1), `detectRegion`/`detectBrand` (A2/A3), `createDealership` (A4), the matcher `suggestGroups` (`lib/match.ts`), the lifecycle (B3).
- Produces: POST `{ source, payload }` → records with detected brand/region + flags → returns the review set. Confirm endpoint creates dealerships + Stage 1 per record.

- [ ] **Step 1: Implement the route** — parse → for each record `detectBrand`, and `detectRegion` if address present (else flag "needs address"), run `suggestGroups(name)` for the likely group; return the review set (name, brand, group suggestion, region/flag).

- [ ] **Step 2: Review table in `app/page.tsx`** — paste/upload, show rows with flags (no region/ASK, brand null, no address, fuzzy group), per-row Confirm → creates the dealership + runs Stage 1.

- [ ] **Step 3: Verify (integration)** — build green; paste two DealerVault lines → review table shows both with detected brand + group suggestion; Confirm one → a dealership + Feed Approval Pending task exist, stamped.

- [ ] **Step 4: Commit** — `git commit -am "feat: feed intake route + review table"`

### Task F3: Reconciliation (form/email task ↔ project)

**Files:**
- Create: `lib/reconcile.ts`
- Modify: `app/api/sweep/route.ts` (call reconcile for unmatched tasks)

**Interfaces:**
- Consumes: `getTask` (`lib/clickup.ts`), `findDealershipsByName`/`suggestDealership` (matcher), id writers.
- Produces: `reconcileTask(taskId): Promise<{matched: boolean; dealershipId?: string}>` — match a form/email-created task to a dealership (fuzzy by name), mint/attach IDs, stamp the task; unmatched → OUTBOX review action.

- [ ] **Step 1: Implement `reconcileTask`** — read the task, fuzzy-match its name to a dealership (reuse `lib/match.ts` normalization); if matched and the task lacks `dealer_id`, stamp `DLR-`/`ONB-`; if no confident match, enqueue an OUTBOX `create_task` review action naming the orphan.

- [ ] **Step 2: Verify** — build green; create a bare ClickUp task named like an existing dealer on `901105435045`, run reconcile → it stamps the Dealer ID.

- [ ] **Step 3: Commit** — `git commit -am "feat: reconcile form/email tasks to projects"`

---

## Self-Review Notes (author)

- **Spec coverage:** §1 integrate-not-rebuild → all phases stamp onto existing tasks (B2/F3); §2 lifecycle → B3; §2.5 comms arm → C1–C6; §3 data model → A1; §4 region/brand → A2/A3; §5 task builder → B1/B2; §6 roster → E1–E4; §7 emails → D1 (+ Mail.Send check C1); §8 feeds → F1/F2 (agent-side scrape/address noted, not app tasks); §9 reconciliation → F3; §10 review queue → OUTBOX (C3) + feed review (F2); §11 UI → buttons/panels across B/C/E/F; §12 verification model honored (build-green + Neon/ClickUp checks; vitest for pure logic).
- **No test runner originally** → Task 0 adds vitest; integration tasks verify via build + live checks (matches the project's real model).
- **Type consistency:** `Dealership` extended once (A4) and consumed by B2/B3/D1; `RosterRow` defined E1, used E2/E3/E4; `Decision` defined C2, used C5; `FeedRecord` defined F1, used F2.
- **Agent-side pieces** (Tekion APC scrape, web-search address lookup) are intentionally NOT app tasks — they feed `/api/feeds` and `/api/roster`; called out in the spec §8.

