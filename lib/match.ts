import { listOpenGroups, type DealerGroup } from '@/lib/groups';
import { listDealershipsByGroup, type Dealership } from '@/lib/dealerships';

// Abbreviation expansion so "Concord CDJR" matches "Concord Chrysler Dodge Jeep Ram".
const ABBREV: [RegExp, string][] = [
  [/\bcdjr\b/g, 'chrysler dodge jeep ram'], [/\bcjdr\b/g, 'chrysler dodge jeep ram'],
  [/\bcdj\b/g, 'chrysler dodge jeep'], [/\bvw\b/g, 'volkswagen'], [/\bvolkswagon\b/g, 'volkswagen'],
  [/\bchevy\b/g, 'chevrolet'], [/\bmb\b/g, 'mercedes benz'], [/\bgmc\b/g, 'gmc'],
];
const STOP = new Set(['of', 'the', 'and', 'a', 'at', 'inc', 'llc', 'auto', 'automotive', 'motors', 'dealership']);

export function normalizeName(name: string): string[] {
  let s = (name || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ');
  for (const [re, exp] of ABBREV) s = s.replace(re, exp);
  return s.split(/\s+/).filter((t) => t && !STOP.has(t));
}

// Token-set Jaccard — order-independent, so "Modesto Toyota" ↔ "Toyota of Modesto" = 1.0.
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
// any expected-store similarity). Higher = more confident.
export async function suggestGroups(storeName: string): Promise<Suggestion[]> {
  const groups = await listOpenGroups();
  const out: Suggestion[] = [];
  for (const g of groups) {
    const dealerships = await listDealershipsByGroup(g.id);
    let best = similarity(storeName, g.name);
    let matched: Dealership | null = null;
    for (const d of dealerships) {
      const s = similarity(storeName, d.name);
      if (s > best) { best = s; matched = d; } else if (s > 0 && !matched) { matched = d; }
    }
    out.push({ group: g, score: Number(best.toFixed(3)), matchedStore: matched });
  }
  return out.sort((a, b) => b.score - a.score);
}
