import Anthropic from '@anthropic-ai/sdk';
import * as XLSX from 'xlsx';

// Roster extraction core — deterministic Excel pass + AI text/image extractors,
// unified through the applyCompleteness matrix.

export interface RosterRow {
  name: string;
  email: string;
  role: string;
  dms_id: string;
  source: string;
  confidence: number;
  missing: string[];
  action: string;
}

// Valid roles: manager|owner|gm|fod|advisor|technician
// Valid actions: none|reach_back|internal_id_pull|clear_manually

// DMS systems that require an advisor/technician dms_id
const DMS_NEEDS_ID = new Set(['cdk', 'fortellis', 'dealertrack']);

// Roles that require email
const ROLES_NEED_EMAIL = new Set(['manager', 'owner', 'gm', 'fod', 'advisor']);

// Roles that may need dms_id (advisor AND technician)
const ROLES_NEED_DMS_ID = new Set(['advisor', 'technician']);

/**
 * PURE completeness matrix — no I/O. Determines missing fields and action
 * for a single row given the dealership's underlying DMS system.
 *
 * Precedence rule: reach_back (email missing) beats internal_id_pull (dms_id
 * missing). Email is the only thing that goes back to the sender.
 */
export function applyCompleteness(row: RosterRow, underlyingDms: string): RosterRow {
  const missing: string[] = [...row.missing];
  let action = 'none';

  const role = row.role.toLowerCase().trim();
  const dmsLower = underlyingDms.toLowerCase().trim();
  const dmsNeedsId = DMS_NEEDS_ID.has(dmsLower);

  // 1. Email required for manager/owner/gm/fod/advisor (NOT technician)
  const emailRequired = ROLES_NEED_EMAIL.has(role);
  const emailMissing = !row.email || row.email.trim() === '';

  if (emailRequired && emailMissing && !missing.includes('email')) {
    missing.push('email');
  }

  // 2. DMS ID needed only for advisor & technician on CDK/Fortellis/DealerTrack
  const dmsIdRequired = ROLES_NEED_DMS_ID.has(role) && dmsNeedsId;
  const dmsIdMissing = !row.dms_id || row.dms_id.trim() === '';

  if (dmsIdRequired && dmsIdMissing && !missing.includes('dms_id')) {
    missing.push('dms_id');
  }

  // 3. Determine action — reach_back wins over internal_id_pull
  if (emailRequired && emailMissing) {
    action = 'reach_back';
  } else if (dmsIdRequired && dmsIdMissing) {
    action = 'internal_id_pull';
  }

  return { ...row, missing, action };
}

// ─── Header normalisation ──────────────────────────────────────────────────────

type HeaderMap = { name: number; email: number; role: number; dms_id: number };

const NAME_VARIANTS = ['name', 'full name', 'user', 'employee'];
const EMAIL_VARIANTS = ['email', 'e-mail'];
const ROLE_VARIANTS = ['role', 'title', 'position'];
const DMS_VARIANTS = ['dms id', 'advisor #', 'advisor number', 'id', 'user id'];

function findHeaderIndex(headers: string[], variants: string[]): number {
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i].toLowerCase().trim();
    if (variants.includes(h)) return i;
  }
  return -1;
}

function looksLikeEmail(val: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val.trim());
}

function looksLikeHeaderRow(cells: string[]): boolean {
  const joined = cells.join(' ').toLowerCase();
  return (
    NAME_VARIANTS.some((v) => joined.includes(v)) ||
    EMAIL_VARIANTS.some((v) => joined.includes(v)) ||
    ROLE_VARIANTS.some((v) => joined.includes(v))
  );
}

/**
 * Parse raw 2D cell array into RosterRows. Handles two layouts:
 *  A) Standard table with a detectable header row (name/email/role/id columns)
 *  B) Freeform "Name email" lines (no header row)
 */
function parseSheetRows(rawRows: string[][], source: string): RosterRow[] {
  const results: RosterRow[] = [];

  // Find first header row
  let headerIdx = -1;
  let headerMap: HeaderMap | null = null;

  for (let i = 0; i < rawRows.length; i++) {
    const cells = rawRows[i].map((c) => String(c ?? ''));
    if (looksLikeHeaderRow(cells)) {
      const map: HeaderMap = {
        name: findHeaderIndex(cells, NAME_VARIANTS),
        email: findHeaderIndex(cells, EMAIL_VARIANTS),
        role: findHeaderIndex(cells, ROLE_VARIANTS),
        dms_id: findHeaderIndex(cells, DMS_VARIANTS),
      };
      if (map.name >= 0 || map.email >= 0) {
        headerIdx = i;
        headerMap = map;
        break;
      }
    }
  }

  if (headerMap) {
    // Layout A: structured table
    const map = headerMap;
    for (let i = headerIdx + 1; i < rawRows.length; i++) {
      const cells = rawRows[i].map((c) => String(c ?? '').trim());
      // Skip blank / separator rows
      if (cells.every((c) => c === '')) continue;

      const name = map.name >= 0 ? cells[map.name] ?? '' : '';
      const email = map.email >= 0 ? cells[map.email] ?? '' : '';
      const role = map.role >= 0 ? cells[map.role] ?? '' : '';
      const dms_id = map.dms_id >= 0 ? cells[map.dms_id] ?? '' : '';

      if (!name && !email) continue;

      results.push({
        name,
        email,
        role,
        dms_id,
        source,
        confidence: 1,
        missing: [],
        action: 'none',
      });
    }
  } else {
    // Layout B: freeform — try to extract name/email from each non-blank row
    for (const rawCells of rawRows) {
      const cells = rawCells.map((c) => String(c ?? '').trim()).filter(Boolean);
      if (cells.length === 0) continue;

      // Look for an email-looking cell
      const emailCell = cells.find(looksLikeEmail) ?? '';
      const otherCells = cells.filter((c) => c !== emailCell);
      const name = otherCells[0] ?? '';

      if (!name && !emailCell) continue;

      results.push({
        name,
        email: emailCell,
        role: '',
        dms_id: '',
        source,
        confidence: emailCell ? 0.8 : 0.5,
        missing: [],
        action: 'none',
      });
    }
  }

  return results;
}

/**
 * Deterministic first-pass extraction from an Excel buffer.
 * Does NOT call applyCompleteness — the route layer does that once it
 * knows the dealership's underlying DMS.
 */
export function extractFromExcel(
  buffer: ArrayBuffer | Uint8Array,
  source: string,
): RosterRow[] {
  const wb = XLSX.read(buffer, { type: 'array' });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return [];

  const ws = wb.Sheets[sheetName];
  // sheet_to_json with header:1 gives us string[][] (raw rows)
  const rawRows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  const stringRows = rawRows.map((row) => (row as unknown[]).map((c) => String(c ?? '')));

  return parseSheetRows(stringRows, source);
}

// ─── Anthropic helpers ──────────────────────────────────────────────────────

const MODEL = 'claude-opus-4-8';

function client(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set.');
  return new Anthropic({ apiKey });
}

const ROSTER_SYSTEM = `You are a data extraction assistant. Extract a roster of people from the provided content.
Return ONLY a JSON array (no markdown fences, no prose) of objects with these fields:
  name, email, role, dms_id
where role is one of: manager, owner, gm, fod, advisor, technician (lowercase, pick closest match).
Leave any unknown field as an empty string. If no roster is found, return [].`;

type RawRow = { name?: string; email?: string; role?: string; dms_id?: string };

function parseAIResponse(text: string, source: string): RosterRow[] {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  let parsed: RawRow[];
  try {
    parsed = JSON.parse(cleaned) as RawRow[];
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) return [];

  return parsed.map((r) => ({
    name: String(r.name ?? ''),
    email: String(r.email ?? ''),
    role: String(r.role ?? ''),
    dms_id: String(r.dms_id ?? ''),
    source,
    confidence: 0.9,
    missing: [],
    action: 'none',
  }));
}

/**
 * AI-based extraction from plain text (e.g., email body, pasted list).
 */
export async function extractFromText(
  text: string,
  source: string,
): Promise<RosterRow[]> {
  const res = await client().messages.create({
    model: MODEL,
    max_tokens: 2000,
    system: ROSTER_SYSTEM,
    messages: [{ role: 'user', content: text }],
  });

  const block = res.content.find((b) => b.type === 'text');
  const raw = block && block.type === 'text' ? block.text : '[]';
  return parseAIResponse(raw, source);
}

/**
 * AI-based extraction from an image (base64-encoded) using Anthropic vision.
 */
export async function extractFromImage(
  base64: string,
  mediaType: string,
  source: string,
): Promise<RosterRow[]> {
  const res = await client().messages.create({
    model: MODEL,
    max_tokens: 2000,
    system: ROSTER_SYSTEM,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mediaType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
              data: base64,
            },
          },
          {
            type: 'text',
            text: 'Extract the roster from this image and return ONLY a JSON array.',
          },
        ],
      },
    ],
  });

  const block = res.content.find((b) => b.type === 'text');
  const raw = block && block.type === 'text' ? block.text : '[]';
  return parseAIResponse(raw, source);
}
