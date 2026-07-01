// DMS feed parsers — pure logic, no I/O.
// Each parser converts raw pasted/CSV text into FeedRecord[].

import { titleCase } from './brands';

export interface FeedRecord {
  name: string;
  dms: string;
  conduit: string;
  platform_fields: Record<string, unknown>;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  source: string;
}

// ─── DealerVault (Path C) ─────────────────────────────────────────────────
// Input: one or more tab-separated lines.
// Field order: name\tDVD-id\tDMS\tType\tStatus\t...rest ignored
export function parseDealerVault(text: string): FeedRecord[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const cols = line.split('\t');
      const rawName = cols[0] ?? '';
      const dealervault_id = cols[1] ?? '';
      const underlying_dms = cols[2] ?? '';
      return {
        name: titleCase(rawName),
        dms: underlying_dms,
        conduit: 'dealervault',
        platform_fields: {
          dealervault_id,
          underlying_dms,
        },
        source: 'dealervault',
      };
    });
}

// ─── Tekion (Path D) ──────────────────────────────────────────────────────
// Input: blocks of 8 consecutive non-blank lines per dealer.
// Line 0: Dealer Name, Line 1: Tekion Dealer ID. Rest are informational.
export function parseTekion(text: string): FeedRecord[] {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const records: FeedRecord[] = [];
  for (let i = 0; i + 7 < lines.length; i += 8) {
    const rawName = lines[i];
    const tekion_dealer_id = lines[i + 1];
    records.push({
      name: titleCase(rawName),
      dms: 'Tekion',
      conduit: 'tekion',
      platform_fields: {
        tekion_dealer_id,
      },
      source: 'tekion',
    });
  }
  return records;
}

// ─── Fortellis CSV ────────────────────────────────────────────────────────
// Input: CSV string (first row = headers).
// Column names from process_fortellis.py:
//   "Organization Name", "Organization Address", "Subscription ID", "DMS Attributes"
// Simplified: we parse "Organization Name", address cols, "Subscription ID", and
// extract department_id from "DMS Attributes" JSON if present, or read a plain
// "Department ID" column if present.
export function parseFortellisCsv(csv: string): FeedRecord[] {
  const rows = parseCsvRows(csv);
  if (rows.length < 2) return [];

  const headers = rows[0].map((h) => h.trim());
  const idx = (col: string) => headers.indexOf(col);

  const iName = idx('Organization Name');
  const iAddr = idx('Organization Address');
  const iSub = idx('Subscription ID');
  const iDmsAttrs = idx('DMS Attributes');
  const iDeptId = idx('Department ID'); // fallback if flat column exists

  const records: FeedRecord[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const rawName = (row[iName] ?? '').trim();
    if (!rawName) continue;

    const subscription_id = iSub >= 0 ? (row[iSub] ?? '').trim() : '';
    let department_id = iDeptId >= 0 ? (row[iDeptId] ?? '').trim() : '';

    // Try to extract from DMS Attributes JSON if no flat column
    if (!department_id && iDmsAttrs >= 0) {
      department_id = extractDepartmentId(row[iDmsAttrs] ?? '');
    }

    // Parse address (multi-line or single string)
    const rawAddr = iAddr >= 0 ? (row[iAddr] ?? '') : '';
    const { street, city, state, zip } = parseAddress(rawAddr);

    records.push({
      name: titleCase(rawName),
      dms: 'CDK',
      conduit: 'fortellis',
      platform_fields: {
        subscription_id,
        department_id,
      },
      address: street,
      city,
      state,
      zip,
      source: 'fortellis',
    });
  }
  return records;
}

// ─── Reynolds (RCI) ───────────────────────────────────────────────────────
// Input: individual field object (no multi-record parsing needed for this path).
export function parseReynoldsFields(input: {
  name: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  ppsysid: string;
  store: string;
  branch: string;
}): FeedRecord {
  const store_code = input.store + input.branch;
  return {
    name: titleCase(input.name),
    dms: 'Reynolds',
    conduit: 'reynolds_rci',
    platform_fields: {
      ppsysid: input.ppsysid,
      store_code,
    },
    address: input.address,
    city: input.city,
    state: input.state,
    zip: input.zip,
    source: 'reynolds',
  };
}

// ─── Internal helpers ─────────────────────────────────────────────────────

/**
 * Minimal RFC 4180-compatible CSV parser.
 * Handles double-quoted fields (including embedded commas and newlines).
 */
function parseCsvRows(csv: string): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  let i = 0;

  while (i < csv.length) {
    const ch = csv[i];
    if (inQuotes) {
      if (ch === '"') {
        // Peek ahead: escaped quote?
        if (csv[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(field);
        field = '';
      } else if (ch === '\r') {
        // skip CR in CRLF
      } else if (ch === '\n') {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else {
        field += ch;
      }
    }
    i++;
  }
  // Last row (no trailing newline)
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/**
 * Extract the first department ID from a Fortellis DMS Attributes JSON string.
 * Mirrors process_fortellis.py extract_department_id().
 */
function extractDepartmentId(dmsAttrs: string): string {
  try {
    const data = JSON.parse(dmsAttrs);
    if (Array.isArray(data)) {
      for (const item of data) {
        const depts: unknown[] = item?.departments ?? [];
        for (const dept of depts) {
          const id = (dept as Record<string, unknown>)?.id;
          if (typeof id === 'string' && id) return id;
        }
      }
    }
  } catch {
    // ignore parse errors
  }
  return '';
}

/**
 * Parse a Fortellis address string into components.
 * Supports multi-line "STREET\nCITY STATE ZIP\nUS" format.
 */
function parseAddress(raw: string): { street: string; city: string; state: string; zip: string } {
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  const result = { street: '', city: '', state: '', zip: '' };
  if (lines.length === 0) return result;

  result.street = lines[0];
  if (lines.length >= 2) {
    const part = lines[1].replace(/\s+/g, ' ').trim();
    // Try: CITY ST ZIP  (2-letter abbreviation)
    const m = part.match(/^(.+?)\s+([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/);
    if (m) {
      result.city = m[1].trim();
      result.state = m[2].toUpperCase();
      result.zip = m[3];
    } else {
      // Fallback: just store the whole thing as city
      result.city = part;
    }
  }
  return result;
}
